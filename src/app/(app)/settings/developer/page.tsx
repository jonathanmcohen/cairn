import { redirect } from 'next/navigation';

export default function DeveloperSectionIndex() {
  redirect('/settings/developer/api-keys');
}
