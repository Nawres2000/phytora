import { Leaf } from 'lucide-react';

export default function Crops() {
  return (
    <div className="p-8 md:p-12 max-w-4xl mx-auto">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Mes cultures</h1>
      <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-500">
        <Leaf className="mx-auto text-phytora-light mb-3" size={36} />
        Le suivi de vos parcelles et cultures arrive bientôt.
      </div>
    </div>
  );
}
