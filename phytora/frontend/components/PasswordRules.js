import { Check, Circle } from 'lucide-react';
import { RULES } from '@/lib/password';

export default function PasswordRules({ value }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs" aria-label="Exigences du mot de passe">
      {RULES.map(([label, test]) => {
        const ok = test(value);
        return (
          <li key={label} className={`flex items-center gap-1.5 ${ok ? 'text-phytora-dark font-medium' : 'text-gray-400'}`}>
            {ok ? <Check size={14} /> : <Circle size={14} />}{label}
            <span className="sr-only">{ok ? ' (respecté)' : ' (non respecté)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
