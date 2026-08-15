import { Pressable, StyleSheet, Text } from "react-native";
import { usePermission } from "@/lib/permissions";
import { colors } from "@/constants/theme";

type Permission = "create" | "read" | "update" | "delete";

interface PermissionButtonProps {
  /** The resource to check permissions for (e.g., "staff", "inventoryItems", "users") */
  resource: string;
  /** The action required (e.g., "delete", "update") */
  action: Permission;
  /** The label to display on the button */
  label: string;
  /** Callback when the button is pressed (only called if permission is granted) */
  onPress: () => void;
  /** Optional style overrides */
  style?: any;
  /** Optional text style overrides */
  textStyle?: any;
  /** Show a disabled state if permission is denied (default: true) */
  showDisabled?: boolean;
}

/**
 * A permission-aware button that automatically checks if the user has access
 * to perform the specified action on the resource. Supports both app-level
 * (admin operations like "users") and org-level (organization scoped resources
 * like "staff", "inventoryItems", etc).
 *
 * The button is disabled if the user lacks permission, or hidden if
 * showDisabled is false.
 *
 * Example usage:
 * - Delete a user (app-level): <PermissionButton resource="users" action="delete" ... />
 * - Delete staff (org-level): <PermissionButton resource="staff" action="delete" ... />
 * - Update inventory: <PermissionButton resource="inventoryItems" action="update" ... />
 */
export function PermissionButton({
  resource,
  action,
  label,
  onPress,
  style,
  textStyle,
  showDisabled = true,
}: PermissionButtonProps) {
  const permissions = usePermission();

  // The unified can() method handles both app and org resources
  const hasPermission = permissions.can(resource, action);

  if (!hasPermission && !showDisabled) {
    return null;
  }

  return (
    <Pressable
      style={[styles.button, !hasPermission && styles.buttonDisabled, style]}
      onPress={onPress}
      disabled={!hasPermission}
    >
      <Text
        style={[
          styles.buttonText,
          !hasPermission && styles.buttonTextDisabled,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Utility hook to check if a resource/action is allowed.
 * Use this directly in conditionals where you need to check permissions
 * without rendering a button.
 *
 * Example: const canDelete = useResourcePermission("staff", "delete");
 */
export function useResourcePermission(resource: string, action: Permission) {
  const permissions = usePermission();
  return permissions.can(resource, action);
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: colors.grey300,
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
  buttonTextDisabled: {
    color: colors.grey600,
  },
});
