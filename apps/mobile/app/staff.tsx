import { SimpleScreen } from "@/components/SimpleScreen";
export default function Screen() {
  return <SimpleScreen title="Staff and Partners" rows={[{ label: "Owner", value: "You", icon: "account-circle" }]} fabLabel="Add Staff" />;
}
