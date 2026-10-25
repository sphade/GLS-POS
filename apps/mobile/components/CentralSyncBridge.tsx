import { useEffect } from "react";
import * as Network from "expo-network";
import { AppState } from "react-native";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { OFFLINE_MODE } from "@/lib/offline";
import {
  flushCentralOutbox,
  refreshCentralAllocations,
  refreshCentralItems,
  subscribeCentralWrites,
} from "@/lib/central";

const INTERVAL_MS = 20_000;

/**
 * Drains the central-stock outbox and refreshes its cache in the background.
 *
 * This sits outside the store Durable Object sync engine because central items
 * and allocations live in the control-plane D1 database, not in the branch's
 * document store. It still follows the same rule: local SQLite is the source of
 * truth until the server accepts the queued operation.
 */
export function CentralSyncBridge() {
  const { user, stores } = useAuth();
  const { store } = useStore();

  useEffect(() => {
    if (OFFLINE_MODE || !user) return;

    const actor = { id: user.id, name: user.name, email: user.email };
    const memberships = stores.map((membership) => ({ id: membership.id }));
    const central = stores.find((membership) => membership.isCentral);
    const branches = stores.filter((membership) => !membership.isCentral);

    let stopped = false;
    let running = false;
    let rerun = false;

    const tick = async () => {
      const network = await Network.getNetworkStateAsync();
      if (!network.isConnected) return;

      if (central) {
        await flushCentralOutbox(central.id, actor, memberships);
        await refreshCentralItems(central.id);
        await refreshCentralAllocations(central.id);
      }

      for (const branch of branches) {
        await flushCentralOutbox(branch.id, actor, memberships);
      }

      const activeBranch = branches.find((branch) => branch.id === store.id);
      if (activeBranch) {
        await refreshCentralAllocations(activeBranch.id, {
          toStoreId: activeBranch.id,
        });
      }
    };

    const run = async () => {
      if (stopped) return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      try {
        do {
          rerun = false;
          await tick();
        } while (rerun && !stopped);
      } finally {
        running = false;
      }
    };

    void run();
    const timer = setInterval(() => void run(), INTERVAL_MS);
    const unsubscribe = subscribeCentralWrites(() => void run());
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });

    return () => {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
      appState.remove();
    };
  }, [store.id, stores, user]);

  return null;
}
