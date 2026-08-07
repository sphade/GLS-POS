import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, currencySymbol } from "@/constants/theme";
import { EditorToolbar, FieldCard, PickerCard, Segmented, formStyles } from "@/components/form";
import { VariantEditor, VARIANT_ICONS } from "@/components/VariantEditor";
import { swatches, useCatalog } from "@/lib/catalog";
import { MEASURES, newVariant, type Measure, type SellBy, type Variant } from "@/lib/cart";
import { feedbackTap } from "@/lib/feedback";

const SYM = currencySymbol("NGN");

/**
 * Product editor, shared by the Items tab and Inventory ▸ Items.
 * Simple mode = one price. Advance mode = a list of variants, each opened in
 * the full VariantEditor sheet.
 */
export default function ItemEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { products, categories, upsertProduct, deleteProduct } = useCatalog();
  const existing = products.find((p) => p.id === id);

  const [mode, setMode] = useState<"left" | "right">("left"); // Simple | Advance
  const [name, setName] = useState(existing?.name ?? "");
  const [categoryId, setCategoryId] = useState<string | undefined>(existing?.categoryId);
  const [price, setPrice] = useState(existing ? String(existing.price / 100) : "");
  const [sellBy, setSellBy] = useState<SellBy>(existing?.sellBy ?? "unit");
  const [measure, setMeasure] = useState<Measure>(existing?.measure ?? MEASURES[0]!);
  const [variants, setVariants] = useState<Variant[]>(existing?.variants ?? []);

  const [catOpen, setCatOpen] = useState(false);
  const [sellByOpen, setSellByOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [touched, setTouched] = useState(false);

  const category = categories.find((c) => c.id === categoryId);
  const isFraction = sellBy === "fraction";
  const priceValid = mode === "right" ? variants.length > 0 : (parseFloat(price) || 0) > 0;
  const dirty = name.trim().length > 0 && priceValid && (touched || !existing);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setTouched(true);
  };

  const sellByLabel = isFraction ? `Sell by Fraction · ${measure.unit}` : "Sell by Unit";

  const onSave = () => {
    upsertProduct({
      id: existing?.id,
      name: name.trim(),
      price: mode === "right" ? (variants[0]?.price ?? 0) : Math.round((parseFloat(price) || 0) * 100),
      currency: "NGN",
      categoryId,
      categoryColor: category?.color ?? colors.primary,
      sellBy,
      measure: isFraction ? measure : undefined,
      variants: mode === "right" ? variants : undefined,
      stockQuantity: mode === "right" ? (variants[0]?.stock ?? null) : null,
    });
    feedbackTap();
    router.back();
  };

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Item" : "Add Item"}
        dirty={dirty}
        onClose={() => router.back()}
        onSave={onSave}
        onFavourite={feedbackTap}
        onDelete={
          existing
            ? () => {
                deleteProduct(existing.id);
                feedbackTap();
                router.back();
              }
            : undefined
        }
      />

      <ScrollView contentContainerStyle={formStyles.body}>
        <FieldCard
          label="Item Name *"
          hint="Ex: Apple"
          value={name}
          onChangeText={edit(setName)}
          valid={name.trim().length > 0}
        />

        <PickerCard
          label="Category: *"
          hint="Ex: Fruits"
          value={category?.name}
          swatch={category?.color}
          valid={!!category}
          onPress={() => {
            feedbackTap();
            setCatOpen(true);
          }}
        />

        {/* Sell by — tapping opens the Unit / Fraction chooser */}
        <Pressable
          style={styles.sellByCard}
          onPress={() => {
            feedbackTap();
            setSellByOpen(true);
          }}
          android_ripple={{ color: "#00000010" }}
        >
          <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          <Text style={styles.sellByText}>{sellByLabel}</Text>
          <Ionicons name="chevron-down" size={22} color={colors.primary} />
        </Pressable>

        {isFraction && (
          <Pressable
            style={styles.measureCard}
            onPress={() => {
              feedbackTap();
              setMeasureOpen(true);
            }}
          >
            <MaterialCommunityIcons name="scale-balance" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.measureTitle}>
                1 {measure.unit} = {measure.ratio} {measure.subUnit}
              </Text>
              <Text style={styles.measureSub}>
                e.g. 0.250 = {Math.round(0.25 * measure.ratio)} {measure.subUnit} · price is per {measure.unit}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={20} color={colors.primary} />
          </Pressable>
        )}

        <Segmented left="Simple" right="Advance" value={mode} onChange={setMode} />

        {mode === "left" ? (
          <>
            <FieldCard
              label={`Selling Price *${isFraction ? ` (per ${measure.unit})` : ""}`}
              hint="0.00"
              value={price}
              onChangeText={edit(setPrice)}
              keyboardType="numeric"
              valid={(parseFloat(price) || 0) > 0}
            />

            <View style={styles.imagePickerCard}>
              <Pressable
                style={[styles.imageCircle, { backgroundColor: category?.color ?? "#EF3E36" }]}
                onPress={feedbackTap}
              >
                <View style={styles.editBadge}>
                  <Ionicons name="pencil" size={15} color={colors.primary} />
                </View>
              </Pressable>
              <Text style={styles.changeImage}>Change image</Text>
            </View>

            <View style={styles.tipBanner}>
              <MaterialCommunityIcons name="lightbulb-on-outline" size={22} color={colors.primary} />
              <Text style={styles.tipText}>
                Pro Tip: Use advance mode for features like stock and profit tracking
              </Text>
            </View>
          </>
        ) : (
          <>
            {variants.map((v, i) => (
              <VariantCard
                key={v.id}
                variant={v}
                index={i}
                total={variants.length}
                measureUnit={isFraction ? measure.unit : undefined}
                onPress={() => setEditingVariant(v)}
                onMove={(dir) => {
                  setTouched(true);
                  setVariants((prev) => {
                    const next = [...prev];
                    const j = i + dir;
                    if (j < 0 || j >= next.length) return prev;
                    [next[i], next[j]] = [next[j]!, next[i]!];
                    return next;
                  });
                }}
              />
            ))}

            <Pressable
              style={styles.addVariant}
              onPress={() => {
                feedbackTap();
                setEditingVariant(newVariant(swatches[variants.length % swatches.length]!));
              }}
            >
              <Text style={styles.addVariantText}>ADD VARIANT</Text>
              <Ionicons name="add" size={22} color={colors.white} />
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Sell By chooser — two cards side by side */}
      <Modal visible={sellByOpen} transparent animationType="slide" onRequestClose={() => setSellByOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSellByOpen(false)}>
          <Pressable style={styles.sellBySheet} onPress={(e) => e.stopPropagation()}>
            <Pressable
              style={styles.sellByOption}
              onPress={() => {
                feedbackTap();
                setSellBy("unit");
                setTouched(true);
                setSellByOpen(false);
              }}
            >
              <Text style={styles.sellByOptionTitle}>Sell By Unit</Text>
              <Text style={styles.sellByOptionBody}>Sell as a whole and fixed unit</Text>
            </Pressable>
            <Pressable
              style={styles.sellByOption}
              onPress={() => {
                feedbackTap();
                setSellBy("fraction");
                setTouched(true);
                setSellByOpen(false);
              }}
            >
              <Text style={styles.sellByOptionTitle}>Sell By Fraction</Text>
              <Text style={styles.sellByOptionBody}>
                Sell as Loose with 1:{measure.ratio}{"\n"}eg: 1{measure.unit.toLowerCase()} = {measure.ratio}
                {measure.subUnit.toLowerCase()}, 0.250 = {Math.round(0.25 * measure.ratio)}{" "}
                {measure.subUnit.toLowerCase()}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Measure chooser */}
      <SimpleSheet visible={measureOpen} title="SELECT MEASURE" onClose={() => setMeasureOpen(false)}>
        {MEASURES.map((m) => (
          <Pressable
            key={m.unit}
            style={styles.sheetRow}
            onPress={() => {
              feedbackTap();
              setMeasure(m);
              setTouched(true);
              setMeasureOpen(false);
            }}
          >
            <Text style={styles.sheetRowText}>
              {m.unit} → {m.subUnit} (1:{m.ratio})
            </Text>
            {measure.unit === m.unit && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
          </Pressable>
        ))}
      </SimpleSheet>

      {/* Category picker */}
      <SimpleSheet
        visible={catOpen}
        title="SELECT CATEGORY"
        onClose={() => setCatOpen(false)}
        addLabel="New Category"
        onAdd={() => {
          setCatOpen(false);
          router.push("/category-editor");
        }}
      >
        {categories.map((c) => (
          <Pressable
            key={c.id}
            style={styles.sheetRow}
            onPress={() => {
              feedbackTap();
              setCategoryId(c.id);
              setTouched(true);
              setCatOpen(false);
            }}
          >
            <View style={[styles.sheetSwatch, { backgroundColor: c.color }]} />
            <Text style={styles.sheetRowText}>{c.name}</Text>
            {categoryId === c.id && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
          </Pressable>
        ))}
      </SimpleSheet>

      {/* Variant editor */}
      <VariantEditor
        visible={!!editingVariant}
        variant={editingVariant}
        sellByFraction={isFraction}
        measureUnit={isFraction ? measure.unit : undefined}
        onClose={() => setEditingVariant(null)}
        onSave={(v) => {
          setTouched(true);
          setVariants((prev) => (prev.some((x) => x.id === v.id) ? prev.map((x) => (x.id === v.id ? v : x)) : [...prev, v]));
          setEditingVariant(null);
        }}
        onDelete={
          editingVariant && variants.some((x) => x.id === editingVariant.id)
            ? () => {
                setTouched(true);
                setVariants((prev) => prev.filter((x) => x.id !== editingVariant!.id));
                setEditingVariant(null);
              }
            : undefined
        }
      />
    </SafeAreaView>
  );
}

/** Compact variant row: avatar + name, the three figures, and the feature icon strip. */
function VariantCard({
  variant,
  index,
  total,
  measureUnit,
  onPress,
  onMove,
}: {
  variant: Variant;
  index: number;
  total: number;
  measureUnit?: string;
  onPress: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const flags: { icon: number; on: boolean }[] = [
    { icon: VARIANT_ICONS.profit, on: variant.trackProfit },
    { icon: VARIANT_ICONS.stockTrack, on: variant.autoUpdateStock },
    { icon: VARIANT_ICONS.stockControl, on: variant.lowStockAlert },
    { icon: VARIANT_ICONS.barcode, on: variant.barcodeOn },
    { icon: VARIANT_ICONS.expiry, on: variant.expiryOn },
    { icon: VARIANT_ICONS.tax, on: variant.taxOn },
    { icon: VARIANT_ICONS.discount, on: variant.compareOn },
    { icon: VARIANT_ICONS.note, on: variant.notesOn },
    { icon: VARIANT_ICONS.modifiers, on: variant.modifiersOn },
  ];

  return (
    <Pressable style={styles.variantCard} onPress={onPress} android_ripple={{ color: "#00000010" }}>
      <View style={styles.variantTop}>
        <View style={[styles.variantAvatar, { backgroundColor: variant.color }]} />
        <Text style={[styles.variantName, !variant.name && { color: colors.grey500 }]} numberOfLines={1}>
          {variant.name || "Enter Variant Name"}
        </Text>
      </View>

      <View style={styles.variantFigures}>
        <Figure label="Selling Price*" value={variant.price ? `${SYM}${variant.price / 100}` : `${SYM}0`} />
        <Figure label="Cost Price" value={variant.cost ? `${SYM}${variant.cost / 100}` : "-"} />
        <Figure
          label={`Stock Available${measureUnit ? ` (${measureUnit})` : ""}`}
          value={variant.stock != null ? String(variant.stock) : "-"}
        />
      </View>

      <View style={styles.variantFlags}>
        {flags.map((f, i) => (
          <Image
            key={i}
            source={f.icon}
            style={[styles.flagIcon, !f.on && { opacity: 0.25 }]}
            resizeMode="contain"
          />
        ))}
        <View style={{ flex: 1 }} />
        <Pressable hitSlop={6} onPress={() => onMove(-1)} disabled={index === 0}>
          <Ionicons name="chevron-up" size={22} color={index === 0 ? colors.grey400 : colors.primary} />
        </Pressable>
        <Pressable hitSlop={6} onPress={() => onMove(1)} disabled={index === total - 1}>
          <Ionicons name="chevron-down" size={22} color={index === total - 1 ? colors.grey400 : colors.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

function SimpleSheet({
  visible,
  title,
  children,
  onClose,
  addLabel,
  onAdd,
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  addLabel?: string;
  onAdd?: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.white} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 380 }}>{children}</ScrollView>
          {addLabel && (
            <Pressable style={styles.sheetAdd} onPress={onAdd}>
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={styles.sheetAddText}>{addLabel}</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sellByCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 18,
    marginBottom: 8,
    elevation: 1,
  },
  sellByText: { flex: 1, fontSize: 17, fontWeight: "600", color: colors.grey900 },

  measureCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.blue50,
    borderRadius: 4,
    padding: 12,
    marginBottom: 8,
  },
  measureTitle: { fontSize: 15, fontWeight: "700", color: colors.primary },
  measureSub: { fontSize: 12, color: colors.grey700, marginTop: 2 },

  imagePickerCard: { alignItems: "center", paddingVertical: 18 },
  imageCircle: { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center" },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
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

  variantCard: { backgroundColor: colors.card, borderRadius: 3, marginBottom: 8, elevation: 1, overflow: "hidden" },
  variantTop: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  variantAvatar: { width: 42, height: 42, borderRadius: 21 },
  variantName: { flex: 1, fontSize: 17, color: colors.grey900 },
  variantFigures: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
  },
  figureLabel: { fontSize: 12, color: colors.grey600 },
  figureValue: { fontSize: 14, color: colors.grey700, marginTop: 4 },
  variantFlags: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
    backgroundColor: colors.grey50,
  },
  flagIcon: { width: 20, height: 20 },

  addVariant: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "center",
    backgroundColor: colors.primary,
    borderRadius: 3,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 12,
    elevation: 2,
  },
  addVariantText: { color: colors.white, fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },

  backdrop: { flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" },
  sellBySheet: { flexDirection: "row", gap: 10, padding: 10 },
  sellByOption: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 3,
    paddingVertical: 22,
    paddingHorizontal: 12,
    alignItems: "center",
    elevation: 3,
  },
  sellByOptionTitle: { fontSize: 18, fontWeight: "700", color: colors.primary, textAlign: "center" },
  sellByOptionBody: { fontSize: 12, color: colors.grey700, textAlign: "center", marginTop: 8, lineHeight: 17 },

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
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey200,
  },
  sheetSwatch: { width: 20, height: 20, borderRadius: 10 },
  sheetRowText: { flex: 1, fontSize: 16, color: colors.grey900 },
  sheetAdd: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 },
  sheetAddText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
