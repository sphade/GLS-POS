import { useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { EditorToolbar, FieldCard, formStyles } from "@/components/form";
import { useCatalog } from "@/lib/catalog";
import { feedbackTap } from "@/lib/feedback";

export default function CustomerEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { customers, upsertCustomer, deleteCustomer } = useCatalog();
  const existing = customers.find((c) => c.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [touched, setTouched] = useState(false);

  const dirty = name.trim().length > 0 && (touched || name !== existing?.name);
  const edit = (setter: (v: string) => void) => (t: string) => {
    setter(t);
    setTouched(true);
  };

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Customer" : "Add Customer"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={() => {
          upsertCustomer({
            id: existing?.id,
            name: name.trim(),
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            address: address.trim() || undefined,
          });
          feedbackTap();
          router.back();
        }}
        onDelete={
          existing
            ? () => {
                deleteCustomer(existing.id);
                feedbackTap();
                router.back();
              }
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Customer Name *"
          hint="Ex: Ada Obi"
          value={name}
          onChangeText={edit(setName)}
          valid={name.trim().length > 0}
        />
        <FieldCard
          label="Mobile Number"
          hint="+234 801 000 0000"
          value={phone}
          onChangeText={edit(setPhone)}
          keyboardType="phone-pad"
          showTick={false}
        />
        <FieldCard
          label="Email"
          hint="name@example.com"
          value={email}
          onChangeText={edit(setEmail)}
          keyboardType="email-address"
          showTick={false}
        />
        <FieldCard label="Address" hint="-" value={address} onChangeText={edit(setAddress)} showTick={false} />
      </ScrollView>
    </SafeAreaView>
  );
}
