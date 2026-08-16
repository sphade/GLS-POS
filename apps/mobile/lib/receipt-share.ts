import { Alert, Linking, Platform, Share } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type { Receipt } from "./cart";
import { buildReceiptHtml, buildReceiptText } from "./receipt-print";

/**
 * Non-thermal ways to get a receipt to the customer. These always work, with no
 * hardware: the OS print dialog (any printer, or "Save as PDF"), a shared PDF
 * file, plain text via the share sheet, or a direct WhatsApp message.
 */

/** Open the OS print dialog — works with AirPrint/Android print services. */
export async function printViaSystem(receipt: Receipt): Promise<void> {
  await Print.printAsync({ html: buildReceiptHtml(receipt) });
}

/** Render to PDF and hand it to the share sheet (WhatsApp, email, Drive...). */
export async function shareReceiptPdf(receipt: Receipt): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: buildReceiptHtml(receipt) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      dialogTitle: `Receipt ${receipt.number}`,
      UTI: "com.adobe.pdf",
    });
  } else {
    Alert.alert("Sharing unavailable", `Saved to: ${uri}`);
  }
}

/** Share the receipt as plain text (SMS, notes, any chat app). */
export async function shareReceiptText(receipt: Receipt): Promise<void> {
  await Share.share({
    message: buildReceiptText(receipt),
    title: `Receipt ${receipt.number}`,
  });
}

/**
 * Send straight to WhatsApp. With a phone number it opens that chat; without
 * one it lets the user choose. Falls back to the share sheet if WhatsApp
 * isn't installed.
 */
export async function sendReceiptWhatsApp(receipt: Receipt, phone?: string): Promise<void> {
  const text = encodeURIComponent(buildReceiptText(receipt));
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  const url = digits ? `whatsapp://send?phone=${digits}&text=${text}` : `whatsapp://send?text=${text}`;

  const canOpen = await Linking.canOpenURL(url).catch(() => false);
  if (!canOpen) {
    await shareReceiptText(receipt);
    return;
  }
  await Linking.openURL(url);
}

/** Open the SMS composer with the receipt text prefilled. */
export async function sendReceiptSms(receipt: Receipt, phone?: string): Promise<void> {
  const body = encodeURIComponent(buildReceiptText(receipt));
  const sep = Platform.OS === "ios" ? "&" : "?";
  const url = `sms:${phone ?? ""}${sep}body=${body}`;
  const canOpen = await Linking.canOpenURL(url).catch(() => false);
  if (!canOpen) {
    await shareReceiptText(receipt);
    return;
  }
  await Linking.openURL(url);
}
