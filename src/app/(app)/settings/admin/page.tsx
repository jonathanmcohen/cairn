import { redirect } from 'next/navigation';

export default function AdminSectionIndex() {
  redirect('/settings/admin/audit');
}
