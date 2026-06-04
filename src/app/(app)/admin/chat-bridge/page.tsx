import { redirect } from 'next/navigation';

// v0.9.9 C5 (#186) — chat-bridge moved into the settings hub. Keep this path
// as a 308 redirect so bookmarks + any OAuth return links resolve.
export default function LegacyChatBridgeRedirect() {
  redirect('/settings/admin/chat-bridge');
}
