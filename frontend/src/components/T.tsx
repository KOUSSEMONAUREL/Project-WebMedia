import { useT } from '@/lib/translate-init';

export function T({ children }: { children: string }) {
  return <>{useT(children)}</>;
}
