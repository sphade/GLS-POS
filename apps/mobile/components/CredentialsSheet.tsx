import { useEffect, useState } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors } from "@/constants/theme";
import { feedbackTap } from "@/lib/feedback";

/**
 * Shows a freshly created (or reset) staff login once, ready to hand over.
 *
 * Staff accounts have no email, so this sheet is the *only* moment the password
 * is visible in plain text — it isn't recoverable afterwards, only resettable.
 * That's why the credentials are laid out as one pre-formatted block with Copy
 * and Share: the owner passes them on via WhatsApp and moves on, instead of
 * squinting at an alert and re-typing.
 */

export type Credentials = {
  /** Person's name, for the greeting line. */
  name: string;
  username: string;
  password: string;
  /** Human-readable role, e.g. "Cashier". */
  role?: string;
  storeName: string;
};

/** The message the owner sends. Kept plain so it survives any chat app. */
export function formatCredentials(c: Credentials): string {
  return [
    `GLS POS login for ${c.storeName}`,
    "",
    `Name: ${c.name}`,
    ...(c.role ? [`Role: ${c.role}`] : []),
    `Username: ${c.username}`,
    `Password: ${c.password}`,
    "",
    "Open the GLS POS app, then sign in with that username and password.",
  ].join("\n");
}

export function CredentialsSheet({
  credentials,
  title = "STAFF ACCOUNT CREATED",
  note,
  onClose,
}: {
  /** Null hides the sheet. */
  credentials: Credentials | null;
  title?: string;
  note?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Reset the button when a different staff member's details come in.
  useEffect(() => {
    setCopied(false);
  }, [credentials?.username]);

  if (!credentials) return null;
  const message = formatCredentials(credentials);

  const copy = async () => {
    feedbackTap();
    await Clipboard.setStringAsync(message);
    setCopied(true);
  };

  const share = async () => {
    feedbackTap();
    try {
      // RN's share sheet covers WhatsApp, SMS, email and the rest, and needs no
      // extra native module. expo-sharing is for files, not text.
      await Share.share({ message });
    } catch {
      // The user dismissed the sheet; nothing to recover from.
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="checkmark-circle" size={22} color={colors.white} />
            <Text style={styles.headerTitle}>{title}</Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.lead}>
              Send these to {credentials.name}. The password can&apos;t be shown again —
              you&apos;d have to reset it.
            </Text>

            <View style={styles.block}>
              <Row label="Username" value={credentials.username} />
              <Row label="Password" value={credentials.password} />
              {credentials.role ? <Row label="Role" value={credentials.role} /> : null}
              <Row label="Shop" value={credentials.storeName} />
            </View>

            {note ? <Text style={styles.note}>{note}</Text> : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.action, copied && styles.actionDone]}
                onPress={() => void copy()}
              >
                <Ionicons
                  name={copied ? "checkmark" : "copy-outline"}
                  size={19}
                  color={colors.white}
                />
                <Text style={styles.actionText}>{copied ? "COPIED" : "COPY"}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => void share()}>
                <Ionicons name="share-social" size={19} color={colors.white} />
                <Text style={styles.actionText}>SHARE</Text>
              </Pressable>
            </View>

            <Pressable style={styles.done} onPress={onClose}>
              <Text style={styles.doneText}>DONE</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000077", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingBottom: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.green,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  headerTitle: { color: colors.white, fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },

  body: { padding: 16 },
  lead: { fontSize: 13, color: colors.grey700, lineHeight: 19 },

  block: {
    backgroundColor: colors.grey50,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.grey300,
    padding: 14,
    marginTop: 14,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowLabel: { width: 84, fontSize: 12, fontWeight: "800", color: colors.grey600, letterSpacing: 0.4 },
  rowValue: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.grey900 },

  note: { fontSize: 12, color: colors.grey600, marginTop: 10, lineHeight: 18 },

  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  action: {
    flex: 1,
    height: 46,
    borderRadius: 6,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  actionDone: { backgroundColor: colors.green },
  actionText: { color: colors.white, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },

  done: { height: 44, alignItems: "center", justifyContent: "center", marginTop: 6 },
  doneText: { color: colors.grey600, fontSize: 14, fontWeight: "800", letterSpacing: 0.5 },
});
