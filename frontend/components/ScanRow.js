export default function ScanRow({ scan, onDelete }) {
  return (
    <li className="flex items-center gap-4 p-4">
      <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {scan.thumb && <img src={scan.thumb} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 truncate">{scan.plant} : {scan.disease}</p>
        <p className="text-xs text-gray-500">
          {new Date(scan.createdAt).toLocaleString('fr-FR')}
          {scan.confidence != null && ` · ${Math.round(scan.confidence * 100)} %`}
          {scan.severity?.percent != null && !scan.isHealthy && ` · sévérité ${scan.severity.percent} % (${scan.severity.level})`}
          {scan.uncertain && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">incertain</span>}
          {scan.feedback?.correct === true && <span className="ml-2 px-1.5 py-0.5 rounded bg-green-100 text-green-800">confirmé</span>}
          {scan.feedback?.correct === false && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-800">corrigé</span>}
          {scan.mock && <span className="ml-2 px-1.5 py-0.5 rounded bg-phytora-warn/20 text-amber-700">démo</span>}
        </p>
      </div>
      <span className={`w-3 h-3 rounded-full ${scan.uncertain ? 'bg-amber-400' : scan.isHealthy ? 'bg-green-500' : 'bg-red-500'}`} title={scan.uncertain ? 'Incertain' : scan.isHealthy ? 'Saine' : 'Malade'} />
      {onDelete && <button onClick={() => onDelete(scan)} className="text-sm text-red-600 hover:underline">Supprimer</button>}
    </li>
  );
}
