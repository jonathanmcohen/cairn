import { permanentRedirect } from 'next/navigation';

export default function TasksRedirect(): never {
  permanentRedirect('/my-tasks');
}
