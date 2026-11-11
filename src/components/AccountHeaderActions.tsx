import { useState } from "react";
import { Bell, LogOut } from "lucide-react";
import { useAuth } from "../context/auth";
import { nav } from "../lib/nav";
import { IconButton, useConfirm } from "./ui";

export function AccountHeaderActions({ unreadCount = 0 }: { unreadCount?: number }) {
  const { signOut } = useAuth();
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);

  async function doSignOut() {
    if (!(await confirm({ title: "Sign out?", message: "You'll stop receiving in-app alerts on this device until you sign in again.", confirmLabel: "Sign out", danger: false, icon: LogOut }))) return;
    setSigningOut(true);
    await signOut();
    nav.reset();
  }

  return (
    <>
      <IconButton icon={LogOut} label="Sign out" loading={signingOut} onClick={() => void doSignOut()} />
      <IconButton
        icon={Bell}
        label={unreadCount ? `${unreadCount} unread alerts` : "Alerts"}
        dot={unreadCount > 0}
        onClick={() => nav.tab("alerts")}
      />
    </>
  );
}
