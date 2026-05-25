import { redirect } from 'next/navigation';

export default function WorkspaceSectionIndex() {
  redirect('/settings/workspace/members');
}
