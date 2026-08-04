import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, strings } from "@/constants/theme";
import { categories } from "@/lib/mock-items";
import { feedbackTap } from "@/lib/feedback";

/** Mirrors activity_add_item_v2 + fragment_variant_edit (Simple / Advance modes). */
export default function ItemEditorScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"simple" | "advance">("simple");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [sellBy, setSellBy] = useState("Sell By Unit");
  const [showCats, setShowCats] = useState(false);

  // Advance toggles
  const [trackProfit, setTrackProfit] = useState(false);
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [lowAlert, setLowAlert] = useState(false);
  const [lowThreshold, setLowThreshold] = useState("");
  const [autoStock, setAutoStock] = useState(true);
  const [preventOversell, setPreventOversell] = useState(false);
  const [barcodeOn, setBarcodeOn] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [expiryOn, setExpiryOn] = useState(false);
  const [taxOn, setTaxOn] = useState(false);
  const [tax, setTax] = useState("");
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [noteOn, setNoteOn] = useState(false);
  const [note, setNote] = useState("");
  const [skuOn, setSkuOn] = useState(false);
  const [sku, setSku] = useState("");

  const dirty = name.length > 0 || price.length > 0;
  const category = categories.find((c) => c.id === categoryId);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} style={styles.tbBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.tbTitle}>{strings.addItem.toUpperCase()}</Text>
        <View style={styles.tbRight}>
          <Pressable onPress={feedbackTap} style={styles.tbBtn}>
            <Ionicons name="star-outline" size={22} color={colors.green} />
          </Pressable>
          {dirty && (
            <Pressable
              style={styles.saveBtn}
              onPress={() => {
                feedbackTap();
                router.back();
              }}
            >
              <Text style={styles.saveText}>{strings.save}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 32 }}>
        <Field label="Item Name *" hint="Ex: Apple" value={name} onChangeText={setName} valid={name.length > 0} />

        <Pressable
          style={styles.card}
          onPress={() => {
            feedbackTap();
            setShowCats((v) => !v);
          }}
        >
          <View style={styles.fieldRow}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={category ? colors.green : colors.grey400}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Category: *</Text>
              <Text style={[styles.fieldValue, !category && { color: colors.hint }]}>
                {category?.name ?? "Ex: Fruits"}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={20} color={colors.primary} />
          </View>
        </Pressable>

        {showCats && (
          <View style={styles.catList}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                style={styles.catRow}
                onPress={() => {
                  feedbackTap();
                  setCategoryId(c.id);
                  setShowCats(false);
                }}
              >
                <View style={[styles.catDot, { backgroundColor: c.color }]} />
                <Text style={styles.catName}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable style={styles.card} onPress={feedbackTap}>
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldValue, { flex: 1 }]}>{sellBy}</Text>
            <Ionicons name="chevron-down" size={20} color={colors.primary} />
          </View>
        </Pressable>

        <View style={styles.tabCard}>
          <Pressable style={[styles.tabHalf, mode === "simple" && styles.tabActive]} onPress={() => setMode("simple")}>
            <Text style={[styles.tabText, mode === "simple" && styles.tabTextActive]}>Simple</Text>
          </Pressable>
          <Pressable style={[styles.tabHalf, mode === "advance" && styles.tabActive]} onPress={() => setMode("advance")}>
            <Text style={[styles.tabText, mode === "advance" && styles.tabTextActive]}>Advance</Text>
          </Pressable>
        </View>

        <Field
          label="Selling Price *"
          hint="0.00"
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
          valid={price.length > 0}
        />

        <View style={styles.imagePickerCard}>
          <View style={styles.imagePlaceholder}>
            <MaterialCommunityIcons name="image-outline" size={40} color={colors.grey400} />
            <View style={styles.editBadge}>
              <Ionicons name="pencil" size={14} color={colors.primary} />
            </View>
          </View>
          <Text style={styles.changeImage}>Change image</Text>
        </View>

        {mode === "simple" ? (
          <View style={styles.tipBanner}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={22} color={colors.primary} />
            <Text style={styles.tipText}>
              Pro Tip: Use advance mode for features like stock and profit tracking
            </Text>
          </View>
        ) : (
          <>
            <FeatureCard icon="chart-line" label="Track Profit?" on={trackProfit} onToggle={setTrackProfit}>
              <Field label="Cost Price" hint="0.00" value={cost} onChangeText={setCost} keyboardType="numeric" flat />
            </FeatureCard>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Stock</Text>
              <Field label="Stock Available" hint="0" value={stock} onChangeText={setStock} keyboardType="numeric" flat />
              <ToggleRow label="Low stock alerts?" value={lowAlert} onValueChange={setLowAlert} />
              {lowAlert && (
                <Field label="Low Stock Alert" hint="Below 5" value={lowThreshold} onChangeText={setLowThreshold} keyboardType="numeric" flat />
              )}
              <ToggleRow label="Auto-update stock on item sales" value={autoStock} onValueChange={setAutoStock} />
              <ToggleRow label="Prevent item sale when out of stock?" value={preventOversell} onValueChange={setPreventOversell} />
            </View>

            <FeatureCard icon="barcode" label="Barcode?" on={barcodeOn} onToggle={setBarcodeOn}>
              <Field label="Barcode" hint="xxxxxxxx" value={barcode} onChangeText={setBarcode} flat />
              <View style={styles.btnRow}>
                <Pressable style={styles.smallBtn} onPress={feedbackTap}>
                  <Text style={styles.smallBtnText}>Generate</Text>
                </Pressable>
                <Pressable style={styles.smallBtn} onPress={() => router.push("/scanner")}>
                  <Text style={styles.smallBtnText}>Scan</Text>
                </Pressable>
              </View>
            </FeatureCard>

            <FeatureCard icon="calendar-clock" label="Track Expiry?" on={expiryOn} onToggle={setExpiryOn}>
              <Field label="Expiry Date" hint="Select date" value="" onChangeText={() => {}} flat />
            </FeatureCard>

            <FeatureCard icon="percent" label="Add Tax" on={taxOn} onToggle={setTaxOn}>
              <Field label="Enter Tax (%)" hint="0" value={tax} onChangeText={setTax} keyboardType="numeric" flat />
              <ToggleRow label="Inclusive of Tax ?" value={taxInclusive} onValueChange={setTaxInclusive} />
            </FeatureCard>

            <FeatureCard icon="note-text-outline" label="Internal Notes" on={noteOn} onToggle={setNoteOn}>
              <Field label="Internal Notes" hint="-" value={note} onChangeText={setNote} flat />
            </FeatureCard>

            <FeatureCard icon="tag-outline" label="SKU" on={skuOn} onToggle={setSkuOn}>
              <Field label="SKU" hint="-" value={sku} onChangeText={setSku} flat />
            </FeatureCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  hint,
  value,
  onChangeText,
  keyboardType,
  valid,
  flat,
}: {
  label: string;
  hint: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: "numeric" | "default";
  valid?: boolean;
  flat?: boolean;
}) {
  return (
    <View style={flat ? styles.flatField : styles.card}>
      <View style={styles.fieldRow}>
        {!flat && (
          <Ionicons name="checkmark-circle" size={20} color={valid ? colors.green : colors.grey400} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.fieldInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={hint}
            placeholderTextColor={colors.hint}
            keyboardType={keyboardType ?? "default"}
          />
        </View>
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={(v) => {
          feedbackTap();
          onValueChange(v);
        }}
        trackColor={{ true: colors.primary + "88", false: colors.grey400 }}
        thumbColor={value ? colors.primary : colors.grey100}
      />
    </View>
  );
}

function FeatureCard({
  icon,
  label,
  on,
  onToggle,
  children,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.featureHeader}>
        <MaterialCommunityIcons name={icon} size={24} color={colors.primary} />
        <Text style={styles.featureLabel}>{label}</Text>
        <Ionicons name="help-circle-outline" size={18} color={colors.grey500} />
        <Switch
          value={on}
          onValueChange={(v) => {
            feedbackTap();
            onToggle(v);
          }}
          trackColor={{ true: colors.primary + "88", false: colors.grey400 }}
          thumbColor={on ? colors.primary : colors.grey100}
        />
      </View>
      {on && <View style={styles.featureBody}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.screenBg },
  toolbar: {
    backgroundColor: colors.grey100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    elevation: 4,
  },
  tbBtn: { width: 44, alignItems: "center" },
  tbTitle: { fontSize: 16, fontWeight: "700", color: colors.primary },
  tbRight: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 8 },
  saveBtn: { backgroundColor: colors.green, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 7 },
  saveText: { color: colors.white, fontWeight: "700" },
  card: { backgroundColor: colors.card, borderRadius: 4, padding: 12, marginBottom: 8, elevation: 1 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: colors.grey600, marginBottom: 4 },
  flatField: { marginTop: 6 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.grey600 },
  fieldValue: { fontSize: 16, fontWeight: "700", color: colors.grey800, marginTop: 2 },
  fieldInput: { fontSize: 16, fontWeight: "700", color: colors.grey800, padding: 0, marginTop: 2 },
  catList: { backgroundColor: colors.card, borderRadius: 4, marginBottom: 8, elevation: 1 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  catDot: { width: 14, height: 14, borderRadius: 7 },
  catName: { fontSize: 15, color: colors.grey800 },
  tabCard: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 4, overflow: "hidden", marginBottom: 8, elevation: 2 },
  tabHalf: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 16, fontWeight: "700", color: colors.primary },
  tabTextActive: { color: colors.white },
  imagePickerCard: { backgroundColor: colors.card, borderRadius: 4, padding: 14, marginBottom: 8, alignItems: "center", elevation: 1 },
  imagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 6,
    backgroundColor: colors.grey100,
    alignItems: "center",
    justifyContent: "center",
  },
  editBadge: {
    position: "absolute",
    bottom: -6,
    right: -6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  changeImage: { color: colors.blue600, fontSize: 14, marginTop: 12, fontWeight: "600" },
  tipBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.blue50,
    borderRadius: 4,
    padding: 12,
  },
  tipText: { flex: 1, fontSize: 13, color: colors.primary },
  featureHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureLabel: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.grey800 },
  featureBody: { marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.grey300, paddingTop: 6 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  toggleLabel: { flex: 1, fontSize: 14, color: colors.grey700 },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 4,
    paddingVertical: 8,
    alignItems: "center",
  },
  smallBtnText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
});
