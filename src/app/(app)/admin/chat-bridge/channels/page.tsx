import { redirect } from 'next/navigation';

// v0.9.9 C5 (#186) — channel-links moved into the settings hub. Keep this path
// as a 308 redirect so bookmarks resolve.
export default function LegacyChatBridgeChannelsRedirect() {
  redirect('/settings/admin/chat-bridge/channels');
}
