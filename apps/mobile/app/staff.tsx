import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ALL_ROLES, ROLE_LABELS, ROLE_PERMISSIONS, type StoreRole } from "@gls-pos/types";
import { colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { api, type StoreMember } from "@/lib/api";
import { feedbackError, feedbackTap } from "@/lib/feedback";
import { CredentialsSheet, type Credentials } from "@/components/CredentialsSheet";

/**
 * Staff & access. Lists everyone with access to the current store and lets an
 * owner grant/change roles by email or revoke access.
 *
 * Roles are control-plane data (D1), so this screen talks to the API directly
 * rather than the offline catalog — access control must never be stale.
 */
export default function StaffScreen() {
  const router = useRouter();
  const { store } = useStore();
  const { can, role: myRole, user } = useAuth();
  const isOwner = myRole === "owner";

  const [members, setMembers] = useState<StoreMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetting, setResetting] = useState<StoreMember | null>(null);
  /** Credentials to hand over, shown once after create or reset. */
  const [handover, setHandover] = useState<Credentials | null>(null);
  const [handoverTitle, setHandoverTitle] = useState("STAFF ACCOUNT CREATED");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.listMembers(store.id);
    if (res.ok) setMembers(res.data);
    else setError(res.error.message);
    setLoading(false);
  }, [store.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = (member: StoreMember) => {
    if (!isOwner) return;
    feedbackTap();
    Alert.alert(
      member.name,
      `Change role for ${member.username ? `@${member.username}` : member.email}`,
      [
        ...ALL_ROLES.map((r) => ({
          text: `${ROLE_LABELS[r]}${r === member.role ? " (current)" : ""}`,
          onPress: async () => {
            if (r === member.role) return;
            const res = await api.setMemberRole(store.id, member.email, r);
            if (!res.ok) {
              feedbackError();
              Alert.alert("Could not change role", res.error.message);
              return;
            }
            void load();
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  };

  const revoke = (member: StoreMember) => {
    feedbackTap();
    Alert.alert("Remove access?", `${member.name} will lose access to ${store.name}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const res = await api.removeMember(store.id, member.userId);
          if (!res.ok) {
            feedbackError();
            Alert.alert("Could not remove", res.error.message);
            return;
          }
          void load();
        },
      },
    ]);
  };

  // Roles are gated server-side too; this is just a clean UI.
  if (!can("staff:manage")) {
    return (
      <SafeAreaView edges={["top"]} style={styles.root}>
        <Toolbar title="STAFF AND PARTNERS" onBack={() => router.back()} />
        <View style={styles.denied}>
          <Ionicons name="lock-closed-outline" size={46} color={colors.grey400} />
          <Text style={styles.deniedText}>You don't have permission to manage staff.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Toolbar title="STAFF AND PARTNERS" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
        {loading && <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={18} color={colors.red500} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void load()} hitSlop={8}>
              <Text style={styles.retry}>RETRY</Text>
            </Pressable>
          </View>
        )}

        {!loading &&
          members.map((m) => {
            const isMe = m.userId === user?.id;
            return (
              <View key={m.userId} style={styles.row}>
                <View style={[styles.avatar, { backgroundColor: roleColor(m.role) }]}>
                  <Text style={styles.avatarText}>{m.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {m.name}
                    {isMe ? " (you)" : ""}
                  </Text>
                  <Text style={styles.email} numberOfLines={1}>
                    {/* Synthetic staff emails are an implementation detail. */}
                    {m.username ? `@${m.username}` : m.email}
                  </Text>
                  <Text style={styles.perms} numberOfLines={1}>
                    {ROLE_PERMISSIONS[m.role].length} permissions
                  </Text>
                </View>
                <Pressable onPress={() => changeRole(m)} disabled={!isOwner}>
                  <View style={[styles.rolePill, { backgroundColor: roleColor(m.role) }]}>
                    <Text style={styles.roleText}>{ROLE_LABELS[m.role].toUpperCase()}</Text>
                    {isOwner && <Ionicons name="chevron-down" size={12} color={colors.white} />}
                  </View>
                </Pressable>
                {isOwner && m.role !== "owner" && (
                  <>
                    {/* There's no email to send a reset link to, so the owner
                        sets a new password directly. */}
                    <Pressable
                      onPress={() => {
                        feedbackTap();
                        setResetting(m);
                      }}
                      hitSlop={8}
                      style={{ paddingLeft: 6 }}
                    >
                      <Ionicons name="key-outline" size={20} color={colors.grey500} />
                    </Pressable>
                    <Pressable onPress={() => revoke(m)} hitSlop={8} style={{ paddingLeft: 6 }}>
                      <Ionicons name="close-circle-outline" size={22} color={colors.grey500} />
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}
      </ScrollView>

      {isOwner && (
        <Pressable
          style={styles.fab}
          onPress={() => {
            feedbackTap();
            setInviteOpen(true);
          }}
        >
          <Ionicons name="person-add" size={20} color={colors.white} />
          <Text style={styles.fabText}>ADD STAFF</Text>
        </Pressable>
      )}

      <InviteSheet
        visible={inviteOpen}
        storeId={store.id}
        storeName={store.name}
        onClose={() => setInviteOpen(false)}
        onDone={(creds) => {
          setInviteOpen(false);
          setHandoverTitle("STAFF ACCOUNT CREATED");
          setHandover(creds);
          void load();
        }}
      />

      <ResetPasswordSheet
        member={resetting}
        storeId={store.id}
        storeName={store.name}
        onClose={() => setResetting(null)}
        onDone={(creds) => {
          setResetting(null);
          setHandoverTitle("PASSWORD CHANGED");
          setHandover(creds);
        }}
      />

      {/* The one and only chance to see the password in plain text. */}
      <CredentialsSheet
        credentials={handover}
        title={handoverTitle}
        onClose={() => setHandover(null)}
      />
    </SafeAreaView>
  );
}

function Toolbar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.toolbar}>
      <Pressable onPress={onBack} style={styles.toolbarBtn} hitSlop={8}>
        <Ionicons name="arrow-back" size={24} color={colors.primary} />
      </Pressable>
      <Text style={styles.toolbarTitle}>{title}</Text>
    </View>
  );
}

function roleColor(role: StoreRole): string {
  switch (role) {
    case "owner":
      return colors.primary;
    case "manager":
      return "#6A1B9A";
    case "cashier":
      return "#0277BD";
    case "waiter":
      return "#EF6C00";
    default:
      return colors.grey600;
  }
}

/** "Tunde A." -> "tunde.a" — mirrors the server's default handle. */
function handleFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 24);
  return base.length >= 3 ? base : `${base}.staff`;
}

/**
 * Create a staff account. The owner types the person's name and a password and
 * hands over the credentials — no email, no invitation to accept, because
 * restaurant staff generally don't have work email addresses.
 */
function InviteSheet({
  visible,
  storeId,
  storeName,
  onClose,
  onDone,
}: {
  visible: boolean;
  storeId: string;
  storeName: string;
  onClose: () => void;
  /** Hands the credentials up so they can be copied/shared once. */
  onDone: (credentials: Credentials) => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StoreRole>("cashier");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Username follows the name until the owner edits it themselves.
  const [handleEdited, setHandleEdited] = useState(false);
  const effectiveHandle = handleEdited ? username : handleFromName(name);
  const valid = name.trim().length > 0 && password.length >= 6 && effectiveHandle.length >= 3;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.createStaff(storeId, {
      name: name.trim(),
      username: effectiveHandle,
      password,
      role,
    });
    setBusy(false);
    if (!res.ok) {
      feedbackError();
      setError(res.error.message);
      return;
    }

    const credentials: Credentials = {
      name: name.trim(),
      username: res.data.username,
      password,
      role: ROLE_LABELS[role],
      storeName,
    };

    setName("");
    setUsername("");
    setPassword("");
    setHandleEdited(false);
    setRole("cashier");
    // Parent shows the copy/share sheet — this is the only time the password is
    // visible, so it must not be a dismissable toast.
    onDone(credentials);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>ADD STAFF</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>

          <View style={{ padding: 16 }}>
            <Text style={styles.label}>Their name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Tunde Adeyemi"
              placeholderTextColor={colors.hint}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Username they'll sign in with</Text>
            <TextInput
              style={styles.input}
              placeholder="tunde.adeyemi"
              placeholderTextColor={colors.hint}
              value={effectiveHandle}
              onChangeText={(v) => {
                setHandleEdited(true);
                setUsername(v.toLowerCase().replace(/[^a-z0-9._-]/g, ""));
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.hint}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
            />
            <Text style={styles.note}>
              Give them this username and password — they sign in with it on their own device.
            </Text>

            <Text style={[styles.label, { marginTop: 16 }]}>Role</Text>
            {ALL_ROLES.filter((r) => r !== "owner").map((r) => (
              <Pressable
                key={r}
                style={styles.roleOption}
                onPress={() => {
                  feedbackTap();
                  setRole(r);
                }}
              >
                <Ionicons
                  name={role === r ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={role === r ? colors.primary : colors.grey500}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleOptionTitle}>{ROLE_LABELS[r]}</Text>
                  <Text style={styles.roleOptionSub}>{describeRole(r)}</Text>
                </View>
              </Pressable>
            ))}

            {error && <Text style={styles.sheetError}>{error}</Text>}

            <Pressable
              style={[styles.cta, (!valid || busy) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!valid || busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.ctaText}>CREATE STAFF ACCOUNT</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Set a new password for a staff member. Staff accounts have no real email, so
 * the owner is the reset path — they type a new password and read it out.
 */
function ResetPasswordSheet({
  member,
  storeId,
  storeName,
  onClose,
  onDone,
}: {
  member: StoreMember | null;
  storeId: string;
  storeName: string;
  onClose: () => void;
  onDone: (credentials: Credentials) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPassword("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!member || password.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.resetStaffPassword(storeId, member.userId, password);
    setBusy(false);
    if (!res.ok) {
      feedbackError();
      setError(res.error.message);
      return;
    }
    const credentials: Credentials = {
      name: member.name,
      username: member.username ?? member.email,
      password,
      role: ROLE_LABELS[member.role],
      storeName,
    };
    setPassword("");
    setError(null);
    // Same handover flow as creation — the new password needs sending on.
    onDone(credentials);
  };

  return (
    <Modal visible={!!member} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>RESET PASSWORD</Text>
            <Pressable onPress={close} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>

          <View style={{ padding: 16 }}>
            <Text style={styles.label}>
              {member?.username ? `@${member.username}` : (member?.name ?? "")}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="New password (at least 6 characters)"
              placeholderTextColor={colors.hint}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
            />
            <Text style={styles.note}>
              Their old password stops working straight away, and they'll be signed out on other
              devices.
            </Text>

            {error && <Text style={styles.sheetError}>{error}</Text>}

            <Pressable
              style={[styles.cta, (password.length < 6 || busy) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={password.length < 6 || busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.ctaText}>SET NEW PASSWORD</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Plain-language summary of what each role can do. */
function describeRole(role: StoreRole): string {
  switch (role) {
    case "manager":
      return "Everything except changing roles";
    case "cashier":
      return "Sell and take payment. No reports or menu edits";
    case "waiter":
      return "Take orders and manage tables only";
    case "kitchen":
      return "Kitchen display only";
    default:
      return "Full access";
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.grey50,
    height: 56,
    paddingHorizontal: 4,
    elevation: 2,
  },
  toolbarBtn: { width: 44, alignItems: "center" },
  toolbarTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },

  denied: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 },
  deniedText: { color: colors.grey600, fontSize: 15, textAlign: "center" },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFEBEE",
    margin: 8,
    borderRadius: 4,
    padding: 12,
  },
  errorText: { flex: 1, color: colors.red500, fontSize: 13, fontWeight: "600" },
  retry: { color: colors.primary, fontWeight: "800", fontSize: 12 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    marginHorizontal: 6,
    marginTop: 6,
    borderRadius: 4,
    padding: 12,
    elevation: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.white, fontWeight: "800", fontSize: 17 },
  name: { fontSize: 16, fontWeight: "700", color: colors.grey900 },
  email: { fontSize: 13, color: colors.grey600, marginTop: 1 },
  perms: { fontSize: 11, color: colors.grey500, marginTop: 2 },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  roleText: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },

  fab: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 14,
    height: 50,
    borderRadius: 6,
    backgroundColor: colors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    elevation: 4,
  },
  fabText: { color: colors.white, fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },

  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingBottom: 20 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  sheetTitle: { color: colors.white, fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },
  label: { fontSize: 12, fontWeight: "800", color: colors.grey600, letterSpacing: 0.6 },
  input: {
    fontSize: 16,
    color: colors.grey900,
    borderBottomWidth: 1,
    borderColor: colors.grey300,
    paddingVertical: 9,
    marginTop: 4,
  },
  note: { fontSize: 12, color: colors.grey600, marginTop: 6 },
  roleOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  roleOptionTitle: { fontSize: 15, fontWeight: "700", color: colors.grey900 },
  roleOptionSub: { fontSize: 12, color: colors.grey600, marginTop: 1 },
  sheetError: { color: colors.red500, fontSize: 13, fontWeight: "600", marginTop: 10 },
  cta: {
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  ctaText: { color: colors.white, fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
});
