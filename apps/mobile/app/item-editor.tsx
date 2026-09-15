import { useEffect, useRef, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, formatMoney } from "@/constants/theme";
import { EditorToolbar, FeatureCard, FieldCard, PickerCard, Segmented, ToggleRow, confirmDelete, formStyles } from "@/components/form";
import { VariantEditor, VARIANT_ICONS } from "@/components/VariantEditor";
import { NumberInput } from "@/components/NumberInput";
import { swatches, useCatalog } from "@/lib/catalog";
import { useAuth } from "@/lib/auth";
import { MEASURES, newVariant, type Measure, type SellBy, type Variant } from "@/lib/cart";
import { feedbackTap } from "@/lib/feedback";



/**
 * Product editor, shared by the Items tab and Inventory ▸ Items.
 * Simple mode = one price. Advance mode = a list of variants, each opened in
 * the full VariantEditor sheet.
 */
export default function ItemEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { products, categories, upsertProduct, deleteProduct, logStockChange } = useCatalog();
  const { can } = useAuth();
  const canEdit = can("catalog:write");
  const canAdjustStock = can("inventory:adjust");
  const existing = products.find((p) => p.id === id);

  const [mode, setMode] = useState<"left" | "right">(
    existing?.variants?.length ? "right" : "left",
  ); // Simple | Advance
  const [name, setName] = useState(existing?.name ?? "");
  const [categoryId, setCategoryId] = useState<string | undefined>(existing?.categoryId);
  const [price, setPrice] = useState(existing ? String(existing.price / 100) : "");
  const [sellBy, setSellBy] = useState<SellBy>(existing?.sellBy ?? "unit");
  const [measure, setMeasure] = useState<Measure>(existing?.measure ?? MEASURES[0]!);
  const [variants, setVariants] = useState<Variant[]>(existing?.variants ?? []);

  // Simple-mode stock control.
  const [trackStock, setTrackStock] = useState(existing ? existing.stockQuantity !== null : false);
  const [stockQty, setStockQty] = useState(
    existing?.stockQuantity != null ? String(existing.stockQuantity) : "",
  );
  const [lowAlert, setLowAlert] = useState(existing?.lowStockAt != null ? String(existing.lowStockAt) : "");
  /** Advance mode: are the variants mutually exclusive (a service) or additive? */
  const [chooseOne, setChooseOne] = useState(!!existing?.chooseOne);
  /** So the whole row can hand focus to its field, not just the input box. */
  const stockQtyRef = useRef<TextInput>(null);
  const lowAlertRef = useRef<TextInput>(null);

  const [catOpen, setCatOpen] = useState(false);
  const [sellByOpen, setSellByOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);
  const [touched, setTouched] = useState(false);

  // A stock adjustment opens above this editor. When it closes, merge only the
  // authoritative stock fields back into the draft so unsaved name/price/form
  // edits survive without later overwriting the newly adjusted balance.
  useEffect(() => {
    if (!existing) return;
    setTrackStock(existing.stockQuantity !== null);
    setStockQty(existing.stockQuantity != null ? String(existing.stockQuantity) : "");
    setVariants((drafts) =>
      drafts.map((draft) => {
        const latest = existing.variants?.find((variant) => variant.id === draft.id);
        return latest
          ? {
              ...draft,
              stock: latest.stock,
              autoUpdateStock: latest.autoUpdateStock,
            }
          : draft;
      }),
    );
  }, [existing?.stockQuantity, existing?.variants]);

  const openStockUpdate = (variantId?: string) => {
    if (!existing) return;
    if (!canAdjustStock) {
      Alert.alert("Permission required", "Your role cannot adjust inventory.");
      return;
    }
    feedbackTap();
    router.push({
      pathname: "/update-stock",
      params: { productId: existing.id, ...(variantId ? { variantId } : {}) },
    });
  };

  const category = categories.find((c) => c.id === categoryId);
  const isFraction = sellBy === "fraction";
  const normalizeDraftStock = (value: number) => {
    const clamped = Math.max(0, value);
    return isFraction ? Math.round(clamped * 1000) / 1000 : Math.round(clamped);
  };
  const existingHasPositiveStock =
    (existing?.stockQuantity ?? 0) > 0 ||
    !!existing?.variants?.some((variant) => (variant.stock ?? 0) > 0);
  const priceValid = mode === "right" ? variants.length > 0 : (parseFloat(price) || 0) > 0;
  const dirty = name.trim().length > 0 && priceValid && (touched || !existing);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setTouched(true);
  };

  const sellByLabel = isFraction ? `Sell by Fraction · ${measure.unit}` : "Sell by Unit";

  const onModeChange = (next: "left" | "right") => {
    if (next === mode) return;

    /**
     * Turning a plain priced item into a variant item keeps that price as a real
     * "Regular" variant. Without this the original item silently stops being
     * sellable the moment you add a second size, which is never what's meant.
     */
    if (next === "right" && variants.length === 0) {
      const basePrice = Math.round((parseFloat(price) || 0) * 100);
      if (basePrice > 0) {
        const baseStock = trackStock ? normalizeDraftStock(parseFloat(stockQty) || 0) : undefined;
        const baseLowAt = lowAlert.trim() ? normalizeDraftStock(parseFloat(lowAlert) || 0) : undefined;
        setVariants([
          {
            ...newVariant(swatches[0]!),
            name: "Regular",
            price: basePrice,
            stock: baseStock,
            lowStockAlert: trackStock && baseLowAt != null,
            lowStockAt: trackStock ? baseLowAt : undefined,
          },
        ]);
      }
    }

    if (mode === "right" && next === "left" && variants.length > 0) {
      if (existing?.variants?.some((variant) => (variant.stock ?? 0) > 0)) {
        Alert.alert(
          "Stock still available",
          "Remove each variant's remaining stock before switching this item to Simple mode.",
        );
        return;
      }
      Alert.alert(
        "Remove all variants?",
        "Saving this item in Simple mode will permanently remove its variants. This cannot be undone.",
        [
          { text: "Keep Advance mode", style: "cancel" },
          {
            text: "Switch to Simple",
            style: "destructive",
            onPress: () => {
              setMode("left");
              setTouched(true);
            },
          },
        ],
      );
      return;
    }
    setMode(next);
    setTouched(true);
  };

  const onSave = () => {
    if (!canEdit) {
      Alert.alert("Permission required", "Your role cannot change catalog items.");
      return;
    }
    let savedVariants: Variant[] | undefined;
    if (mode === "right") {
      if (variants.length === 0) {
        Alert.alert("Variant required", "Add at least one variant before saving in Advance mode.");
        return;
      }

      const names = variants.map((variant) => variant.name.trim());
      if (names.some((variantName) => !variantName)) {
        Alert.alert("Variant name required", "Every variant must have a name.");
        return;
      }
      const normalizedNames = names.map((variantName) => variantName.toLocaleLowerCase());
      if (new Set(normalizedNames).size !== normalizedNames.length) {
        Alert.alert("Duplicate variant names", "Variant names must be unique, ignoring capitalisation.");
        return;
      }

      const ids = variants.map((variant) => variant.id);
      if (
        ids.some((variantId) => !variantId || variantId.trim() !== variantId) ||
        new Set(ids).size !== ids.length
      ) {
        Alert.alert("Invalid variant IDs", "Every variant must keep a stable, unique ID.");
        return;
      }
      if (variants.some((variant) => !Number.isSafeInteger(variant.price) || variant.price <= 0)) {
        Alert.alert("Valid variant prices required", "Every variant price must be a positive whole number of minor currency units.");
        return;
      }

      savedVariants = variants.map((variant, index) => ({
        ...variant,
        name: names[index]!,
        stock: variant.stock == null ? undefined : normalizeDraftStock(variant.stock),
        lowStockAt:
          variant.lowStockAt == null ? undefined : normalizeDraftStock(variant.lowStockAt),
      }));
    }

    const simpleStock = trackStock ? normalizeDraftStock(parseFloat(stockQty) || 0) : null;
    const simpleLowAt = trackStock && lowAlert.trim() ? normalizeDraftStock(parseFloat(lowAlert) || 0) : undefined;
    const nextStock = mode === "right" ? null : simpleStock;
    const nextPrice = mode === "right"
      ? Math.min(...savedVariants!.map((variant) => variant.price))
      : Math.round((parseFloat(price) || 0) * 100);

    const saved = upsertProduct({
      id: existing?.id,
      name: name.trim(),
      price: nextPrice,
      currency: "NGN",
      categoryId,
      categoryColor: category?.color ?? colors.primary,
      sellBy,
      measure: isFraction ? measure : undefined,
      variants: savedVariants,
      // Only meaningful with variants, so it's cleared alongside them.
      chooseOne: mode === "right" ? chooseOne : undefined,
      stockQuantity: nextStock,
      lowStockAt: mode === "right" ? undefined : simpleLowAt,
      autoUpdateStock: mode === "right" ? undefined : (existing?.autoUpdateStock ?? true),
    });

    // Audit trail: log the stock delta from a manual create/edit. The server
    // rebuilds stock from these movements, so every stock change must emit one —
    // both the simple product field and each variant.
    if (mode === "right" && savedVariants) {
      const priorById = new Map((existing?.variants ?? []).map((v) => [v.id, v.stock ?? 0]));
      for (const variant of savedVariants) {
        if (variant.stock == null) continue; // untracked variant
        const before = priorById.get(variant.id) ?? 0;
        const delta = variant.stock - before;
        if (delta !== 0) {
          logStockChange(
            saved,
            delta,
            priorById.has(variant.id) ? "adjustment" : "initial",
            variant.stock,
            { id: variant.id, name: variant.name },
          );
        }
      }
    } else if (nextStock !== null) {
      const before = existing?.stockQuantity ?? 0;
      const delta = nextStock - before;
      if (delta !== 0) {
        logStockChange(saved, delta, existing?.stockQuantity == null ? "initial" : "adjustment", nextStock);
      }
    }

    feedbackTap();
    router.back();
  };

  return (
    <SafeAreaView edges={["top"]} style={formStyles.screen}>
      <EditorToolbar
        title={existing ? "Edit Item" : "Add Item"}
        dirty={dirty && canEdit}
        onClose={() => router.back()}
        onSave={onSave}
        onFavourite={feedbackTap}
        onDelete={
          existing && canEdit
            ? () => {
                if (existingHasPositiveStock) {
                  Alert.alert(
                    "Stock still available",
                    "Remove all remaining stock before deleting this item.",
                  );
                  return;
                }
                confirmDelete(`"${existing.name}"`, () => {
                  deleteProduct(existing.id);
                  feedbackTap();
                  router.back();
                });
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

        <Segmented left="Simple" right="Advance" value={mode} onChange={onModeChange} />

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

            <FeatureCard
              icon="cube-outline"
              label="Track stock"
              on={trackStock}
              onToggle={(next) => {
                if (!next && (existing?.stockQuantity ?? 0) > 0) {
                  Alert.alert(
                    "Stock still available",
                    "Remove the remaining stock before turning tracking off.",
                  );
                  return;
                }
                setTrackStock(next);
                setTouched(true);
              }}
            >
              {existing?.stockQuantity != null ? (
                <Pressable
                  style={styles.stockUpdateRow}
                  onPress={() => openStockUpdate()}
                  android_ripple={{ color: "#00000010" }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stockLabel}>Stock available</Text>
                    <Text style={styles.stockUpdateHint}>Tap the number to add, remove, or see history</Text>
                  </View>
                  <Text style={styles.stockUpdateValue}>{stockQty}</Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.primary} />
                </Pressable>
              ) : (
                /* A newly tracked item still needs an opening balance. Every
                   later change goes through the dedicated stock workflow. */
                <Pressable
                  style={styles.stockRow}
                  accessible={false}
                  onPress={() => stockQtyRef.current?.focus()}
                >
                  <Text style={styles.stockLabel}>Opening quantity</Text>
                  <NumberInput
                    ref={stockQtyRef}
                    style={styles.stockInput}
                    value={stockQty}
                    onChangeText={edit(setStockQty)}
                    decimals={isFraction}
                    placeholder="0"
                    placeholderTextColor={colors.hint}
                  />
                </Pressable>
              )}
              <Pressable
                style={styles.stockRow}
                accessible={false}
                onPress={() => lowAlertRef.current?.focus()}
              >
                <Text style={styles.stockLabel}>Alert when stock at or below</Text>
                <NumberInput
                  ref={lowAlertRef}
                  style={styles.stockInput}
                  value={lowAlert}
                  onChangeText={edit(setLowAlert)}
                  decimals={isFraction}
                  placeholder="—"
                  placeholderTextColor={colors.hint}
                />
              </Pressable>
              <Text style={styles.stockHint}>
                Stock goes down automatically with each sale{isFraction ? ` (per ${measure.unit})` : ""}.
              </Text>
            </FeatureCard>

            <View style={styles.tipBanner}>
              <MaterialCommunityIcons name="lightbulb-on-outline" size={22} color={colors.primary} />
              <Text style={styles.tipText}>
                Pro Tip: Use advance mode for variants and profit tracking
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
                onStockPress={
                  existing?.variants?.find((variant) => variant.id === v.id)?.stock != null
                    ? () => openStockUpdate(v.id)
                    : undefined
                }
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

            {/* Services pick one option and are done; goods can want several of
                each. Off by default so existing items keep their steppers. */}
            <View style={styles.chooseOneCard}>
              <ToggleRow
                label="Pick only one option per sale"
                value={chooseOne}
                onValueChange={(v) => {
                  setTouched(true);
                  setChooseOne(v);
                }}
              />
              <Text style={styles.stockHint}>
                {chooseOne
                  ? "The option list becomes a single choice — tapping one selects it and closes. Use this for services like a car wash."
                  : "The option list shows a quantity stepper on every row, so a sale can include several options at once."}
              </Text>
            </View>
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
        onUpdateStock={
          editingVariant &&
          existing?.variants?.find((variant) => variant.id === editingVariant.id)?.stock != null
            ? () => {
                const variantId = editingVariant.id;
                setEditingVariant(null);
                requestAnimationFrame(() => openStockUpdate(variantId));
              }
            : undefined
        }
        onDelete={
          editingVariant && variants.some((x) => x.id === editingVariant.id)
            ? () => {
                const persisted = existing?.variants?.find(
                  (variant) => variant.id === editingVariant.id,
                );
                if ((persisted?.stock ?? 0) > 0) {
                  Alert.alert(
                    "Stock still available",
                    "Remove this variant's remaining stock before deleting it.",
                  );
                  return;
                }
                setTouched(true);
                setVariants((prev) => prev.filter((x) => x.id !== editingVariant.id));
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
  onStockPress,
  onMove,
}: {
  variant: Variant;
  index: number;
  total: number;
  measureUnit?: string;
  onPress: () => void;
  onStockPress?: () => void;
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
        <Figure label="Selling Price*" value={formatMoney(variant.price ?? 0)} />
        <Figure label="Cost Price" value={variant.cost ? formatMoney(variant.cost) : "-"} />
        <Figure
          label={`Stock Available${measureUnit ? ` (${measureUnit})` : ""}`}
          value={variant.stock != null ? String(variant.stock) : "-"}
          onPress={onStockPress}
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

function Figure({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const content = (
    <>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.figureValueRow}>
        <Text style={[styles.figureValue, onPress && styles.figureValueLink]}>{value}</Text>
        {onPress ? <Ionicons name="open-outline" size={13} color={colors.primary} /> : null}
      </View>
    </>
  );
  return onPress ? (
    <Pressable
      style={{ flex: 1 }}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
    >
      {content}
    </Pressable>
  ) : (
    <View style={{ flex: 1 }}>{content}</View>
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

  stockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
  },
  chooseOneCard: {
    backgroundColor: colors.card,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingBottom: 12,
    marginTop: 8,
    elevation: 1,
  },
  stockLabel: { flex: 1, fontSize: 15, color: colors.grey800 },
  stockUpdateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grey300,
  },
  stockUpdateHint: { color: colors.grey500, fontSize: 10, marginTop: 2 },
  stockUpdateValue: { color: colors.primaryDark, fontSize: 20, fontWeight: "900" },
  stockInput: {
    minWidth: 76,
    borderBottomWidth: 1,
    borderColor: colors.grey400,
    textAlign: "right",
    fontSize: 16,
    fontWeight: "700",
    color: colors.grey900,
    paddingVertical: 4,
  },
  stockHint: { fontSize: 12, color: colors.grey600, marginTop: 8 },

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
  figureValueRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  figureValue: { fontSize: 14, color: colors.grey700 },
  figureValueLink: { color: colors.primaryDark, fontWeight: "800" },
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
