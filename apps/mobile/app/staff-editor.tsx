import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { colors } from "@/constants/theme";
import { EditorToolbar, FieldCard, formStyles } from "@/components/form";
import { useCatalog } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { usePermission } from "@/lib/permissions";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { feedbackTap } from "@/lib/feedback";
import { generateRandomPassword } from "@/lib/password-generator";

const ROLES = ["owner", "manager", "cashier"];

type CredentialsData = {
  name: string;
  email: string;
  password: string;
};

export default function StaffEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { staff, upsertStaff, deleteStaff } = useCatalog();
  const { store } = useStore();
  const { canAppUpdate } = usePermission();
  const { data: session } = useSession();
  const existing = staff.find((s) => s.id === id);

  // Check if viewing own profile
  const isOwnProfile =
    (session?.user as unknown as { id?: string })?.id === existing?.id;
  const isAdmin = canAppUpdate();
  const canEditProfile = isOwnProfile || isAdmin;

  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(existing?.role ?? "cashier");
  const [touched, setTouched] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [credentials, setCredentials] = useState<CredentialsData | null>(null);
  const [copied, setCopied] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordCopied, setResetPasswordCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showUpdatePasswordModal, setShowUpdatePasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [currentPasswordCopied, setCurrentPasswordCopied] = useState(false);
  const [newPasswordCopied, setNewPasswordCopied] = useState(false);

  const isNewStaff = !existing;
  const dirty =
    name.trim().length > 0 &&
    (touched || name !== existing?.name) &&
    canEditProfile;

  const handleGeneratePassword = () => {
    const pwd = generateRandomPassword();
    if (isNewStaff) {
      setPassword(pwd);
    } else if (showResetPasswordModal && isAdmin) {
      setResetPassword(pwd);
    } else if (showUpdatePasswordModal && isOwnProfile) {
      setNewPassword(pwd);
    }
    feedbackTap();
  };

  const handleCopyCredentials = async () => {
    if (credentials) {
      const text = `Name: ${credentials.name}\nEmail: ${credentials.email}\nPassword: ${credentials.password}`;
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      feedbackTap();
    }
  };

  const handleCopyResetPassword = async () => {
    if (resetPassword) {
      await Clipboard.setStringAsync(resetPassword);
      setResetPasswordCopied(true);
      setTimeout(() => setResetPasswordCopied(false), 2000);
      feedbackTap();
    }
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword.trim()) {
      Alert.alert("Error", "Please enter your current password");
      return;
    }

    if (!newPassword.trim()) {
      Alert.alert("Error", "Please enter a new password");
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert("Error", "New password must be at least 8 characters");
      return;
    }

    setUpdatingPassword(true);
    try {
      const result = await api.updateProfile({
        oldPassword: currentPassword,
        newPassword,
      });

      if (!result.ok) {
        Alert.alert(
          "Error",
          result.error.message || "Failed to update password",
        );
        return;
      }

      Alert.alert("Success", "Password updated successfully");
      setShowUpdatePasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      feedbackTap();
    } catch (err) {
      Alert.alert("Error", (err as Error)?.message || "Something went wrong");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPassword.trim()) {
      Alert.alert("Error", "Please enter a password");
      return;
    }

    setResetting(true);
    try {
      const result = await api.admin.updateUser({
        userId: existing?.id ?? "",
        password: resetPassword,
      });

      if (!result.ok) {
        Alert.alert(
          "Error",
          result.error.message || "Failed to reset password",
        );
        return;
      }

      // Show credentials modal with the new password
      setCredentials({
        name: existing?.name ?? "",
        email: existing?.email ?? "",
        password: resetPassword,
      });
      setShowResetPasswordModal(false);
      setShowCredentialsModal(true);
      setResetPassword("");
    } catch (err) {
      Alert.alert("Error", (err as Error)?.message || "Something went wrong");
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;

    Alert.alert(
      "Delete Staff",
      "Are you sure you want to delete this staff member? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete the user from the system (admin operation)
              const result = await api.admin.deleteUser(existing.id);

              if (!result.ok) {
                Alert.alert(
                  "Error",
                  result.error.message || "Failed to delete user",
                );
                return;
              }

              // Delete from local catalog
              deleteStaff(existing.id);
              feedbackTap();
              router.back();
            } catch (err) {
              Alert.alert(
                "Error",
                (err as Error)?.message || "Something went wrong",
              );
            }
          },
        },
      ],
    );
  };

  const handleSave = async () => {
    if (!canEditProfile) {
      Alert.alert("Error", "You don't have permission to edit this profile");
      return;
    }

    if (!name.trim()) {
      Alert.alert("Error", "Please enter staff name");
      return;
    }

    if (!email.trim()) {
      Alert.alert("Error", "Please enter email address");
      return;
    }

    if (isNewStaff && !password.trim()) {
      Alert.alert("Error", "Please enter password");
      return;
    }

    try {
      if (isNewStaff) {
        // Create the user via admin API
        const userResult = await api.admin.createUser({
          email: email.trim(),
          name: name.trim(),
          password,
        });

        if (!userResult.ok) {
          Alert.alert(
            "Error",
            userResult.error.message || "Failed to create user",
          );
          return;
        }

        // Add the user to the organization
        const memberResult = await api.addMemberToOrganization(store.id, {
          userId: userResult.data.user.id,
          role: role.toLowerCase(),
          organizationId: store.id,
        });

        if (!memberResult.ok) {
          Alert.alert(
            "Error",
            memberResult.error.message || "Failed to add user to organization",
          );
          return;
        }

        // Show credentials modal
        setCredentials({
          name: name.trim(),
          email: email.trim(),
          password,
        });
        setShowCredentialsModal(true);
      } else if (isOwnProfile) {
        // User is updating their own profile
        const updatePayload: any = {
          name: name.trim() !== existing.name ? name.trim() : undefined,
          email: email.trim() !== existing.email ? email.trim() : undefined,
        };

        // Remove undefined values
        Object.keys(updatePayload).forEach(
          (key) =>
            updatePayload[key] === undefined && delete updatePayload[key],
        );

        const result = await api.updateProfile(updatePayload);

        if (!result.ok) {
          Alert.alert(
            "Error",
            result.error.message || "Failed to update profile",
          );
          return;
        }

        upsertStaff({
          id: existing.id,
          name: name.trim(),
          email: email.trim(),
          role,
        });
        feedbackTap();
        router.back();
      } else {
        // Admin updating another user (non-password fields)
        const result = await api.admin.updateUser({
          userId: existing.id,
          email: email.trim() !== existing.email ? email.trim() : undefined,
          name: name.trim() !== existing.name ? name.trim() : undefined,
        });

        if (!result.ok) {
          Alert.alert("Error", result.error.message || "Failed to update user");
          return;
        }

        upsertStaff({
          id: existing.id,
          name: name.trim(),
          email: email.trim(),
          role,
        });
        feedbackTap();
        router.back();
      }
    } catch (err) {
      Alert.alert("Error", (err as Error)?.message || "Something went wrong");
    }
  };

  const handleCloseCredentialsModal = () => {
    setShowCredentialsModal(false);
    // Only upsert if this is a new staff (password reset doesn't need upsert)
    if (isNewStaff && credentials) {
      upsertStaff({
        id: credentials.email,
        name: credentials.name,
        email: credentials.email,
        role,
      });
    }
    feedbackTap();
    router.back();
  };

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={isNewStaff ? "Add Staff" : "Edit Staff"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={canEditProfile ? handleSave : undefined}
        onDelete={existing && isAdmin ? handleDelete : undefined}
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Staff Name *"
          hint="Ex: Tunde A."
          value={name}
          onChangeText={(t) => {
            if (canEditProfile) {
              setName(t);
              setTouched(true);
            }
          }}
          valid={name.trim().length > 0}
        />

        <FieldCard
          label="Email *"
          hint="staff@example.com"
          value={email}
          onChangeText={(t) => {
            if (canEditProfile) {
              setEmail(t);
              setTouched(true);
            }
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          valid={email.trim().length > 0}
        />

        {isNewStaff && (
          <>
            <FieldCard
              label="Password *"
              hint="Minimum 8 characters"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setTouched(true);
              }}
              secureTextEntry
              valid={password.length >= 8}
            />
            <Pressable
              style={styles.generateButton}
              onPress={handleGeneratePassword}
            >
              <Text style={styles.generateButtonText}>
                Generate Random Password
              </Text>
            </Pressable>
          </>
        )}

        {!isNewStaff && canEditProfile && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>ROLE</Text>
            <View style={styles.chipRow}>
              {ROLES.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.chip, role === r && styles.chipActive]}
                  onPress={() => {
                    feedbackTap();
                    setRole(r);
                    setTouched(true);
                  }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      role === r && { color: colors.white },
                    ]}
                  >
                    {r}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Show reset password button only for admins editing another user */}
        {!isNewStaff && isAdmin && !isOwnProfile && (
          <Pressable
            style={styles.resetPasswordButton}
            onPress={() => setShowResetPasswordModal(true)}
          >
            <Text style={styles.resetPasswordButtonText}>Reset Password</Text>
          </Pressable>
        )}

        {/* Show update password button only for users viewing their own profile */}
        {!isNewStaff && isOwnProfile && (
          <Pressable
            style={styles.updatePasswordButton}
            onPress={() => setShowUpdatePasswordModal(true)}
          >
            <Text style={styles.updatePasswordButtonText}>Update Password</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={showCredentialsModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {isNewStaff ? "Save Staff Credentials" : "Password Reset"}
            </Text>
            <Text style={styles.modalSubtitle}>
              {isNewStaff
                ? "This is the last chance to copy these credentials. The password cannot be recovered."
                : "Copy the new password. It cannot be recovered."}
            </Text>

            <View style={styles.credentialsBox}>
              {isNewStaff && (
                <>
                  <View style={styles.credentialRow}>
                    <Text style={styles.credentialLabel}>Name:</Text>
                    <Text style={styles.credentialValue}>
                      {credentials?.name}
                    </Text>
                  </View>
                  <View style={styles.credentialRow}>
                    <Text style={styles.credentialLabel}>Email:</Text>
                    <Text style={styles.credentialValue}>
                      {credentials?.email}
                    </Text>
                  </View>
                </>
              )}
              <View style={styles.credentialRow}>
                <Text style={styles.credentialLabel}>Password:</Text>
                <Text style={styles.credentialValue}>
                  {credentials?.password}
                </Text>
              </View>
            </View>

            <Pressable
              style={[styles.copyButton, copied && styles.copyButtonSuccess]}
              onPress={handleCopyCredentials}
            >
              <Text style={styles.copyButtonText}>
                {copied ? "✓ Copied" : "Copy Credentials"}
              </Text>
            </Pressable>

            <Pressable
              style={styles.continueButton}
              onPress={handleCloseCredentialsModal}
            >
              <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showResetPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <Text style={styles.modalSubtitle}>
              Enter a new password for this staff member.
            </Text>

            <FieldCard
              label="New Password *"
              hint="Minimum 8 characters"
              value={resetPassword}
              onChangeText={setResetPassword}
              secureTextEntry
              valid={resetPassword.length >= 8}
            />

            <Pressable
              style={styles.generateButton}
              onPress={handleGeneratePassword}
            >
              <Text style={styles.generateButtonText}>
                Generate Random Password
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.copyButton,
                resetPasswordCopied && styles.copyButtonSuccess,
              ]}
              onPress={handleCopyResetPassword}
            >
              <Text style={styles.copyButtonText}>
                {resetPasswordCopied ? "✓ Copied" : "Copy Password"}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.continueButton, resetting && { opacity: 0.6 }]}
              onPress={handleResetPassword}
              disabled={resetting}
            >
              <Text style={styles.continueButtonText}>
                {resetting ? "Resetting..." : "Reset Password"}
              </Text>
            </Pressable>

            <Pressable
              style={styles.cancelButton}
              onPress={() => setShowResetPasswordModal(false)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showUpdatePasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Update Password</Text>
            <Text style={styles.modalSubtitle}>
              Enter your current password and a new password.
            </Text>

            <TextInput
              style={styles.passwordInput}
              placeholder="Current Password"
              placeholderTextColor={colors.hint}
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />

            <TextInput
              style={styles.passwordInput}
              placeholder="New Password (minimum 8 characters)"
              placeholderTextColor={colors.hint}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <Pressable
              style={styles.generateButton}
              onPress={handleGeneratePassword}
            >
              <Text style={styles.generateButtonText}>
                Generate Random Password
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.continueButton,
                updatingPassword && { opacity: 0.6 },
              ]}
              onPress={handleUpdatePassword}
              disabled={updatingPassword}
            >
              <Text style={styles.continueButtonText}>
                {updatingPassword ? "Updating..." : "Update Password"}
              </Text>
            </Pressable>

            <Pressable
              style={styles.cancelButton}
              onPress={() => {
                setShowUpdatePasswordModal(false);
                setCurrentPassword("");
                setNewPassword("");
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.grey600,
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.grey400,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: colors.grey700 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.grey900,
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.grey600,
    marginBottom: 20,
    lineHeight: 20,
  },
  credentialsBox: {
    backgroundColor: colors.grey100,
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  credentialRow: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-start",
  },
  credentialLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.grey600,
    width: 70,
    textTransform: "uppercase",
  },
  credentialValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.grey900,
    flex: 1,
    fontFamily: "monospace",
  },
  copyButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: "center",
  },
  copyButtonSuccess: {
    backgroundColor: colors.green,
  },
  copyButtonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
  continueButton: {
    backgroundColor: colors.grey200,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: "center",
  },
  continueButtonText: {
    color: colors.grey900,
    fontWeight: "600",
    fontSize: 14,
  },
  generateButton: {
    backgroundColor: colors.grey200,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: "center",
  },
  generateButtonText: {
    color: colors.grey900,
    fontWeight: "600",
    fontSize: 13,
  },
  resetPasswordButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  resetPasswordButtonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
  cancelButton: {
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    color: colors.grey600,
    fontWeight: "600",
    fontSize: 14,
  },
  updatePasswordButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  updatePasswordButtonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
  passwordInput: {
    backgroundColor: colors.grey100,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.grey900,
    borderWidth: 1,
    borderColor: colors.grey300,
    marginBottom: 12,
    fontSize: 14,
  },
});
