import Image from 'next/image';
import logo from '@/assets/logo.jpg';

export default function Logo({ size = 32, light = false }) {
  return (
    <span className="flex items-center gap-3">
      <span className={`p-1.5 rounded-full shadow-lg ${light ? 'bg-white' : 'bg-phytora-light/20'}`}>
        <Image src={logo} alt="Logo PHYTORA" width={size} height={size} className="object-contain rounded-full" />
      </span>
      <span className={`text-2xl font-bold tracking-widest ${light ? 'text-white' : 'text-phytora-dark'}`}>PHYTORA</span>
    </span>
  );
}
