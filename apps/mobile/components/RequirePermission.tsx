import type { ReactNode } from "react";
import type { Permission } from "@gls-pos/types";
import { Redirect, type Href } from "expo-router";
import { useAuth } from "@/lib/auth";

type RequirePermissionProps = {
  permission: Permission;
  children: ReactNode;
  /** Replace the restricted route so Back cannot return to it. */
  fallback?: Href;
};

/**
 * Route boundary for capability-gated screens.
 *
 * Entry-point visibility is only presentation: hidden tabs still exist in the
 * navigator and deep links can address route files directly. This boundary is
 * deliberately outside each screen's data hooks, so an unauthorized role
 * neither renders nor reads the protected local data before being replaced by a
 * safe POS route.
 */
export function RequirePermission({
  permission,
  children,
  fallback = "/(tabs)" as Href,
}: RequirePermissionProps) {
  const { ready, can } = useAuth();
  if (!ready) return null;
  if (!can(permission)) return <Redirect href={fallback} />;
  return <>{children}</>;
}
