import { API } from '@/lib/api';

/**
 * Sends a question to the assistant and reads the Server-Sent Events stream.
 * handlers: onMeta({conversationId, title, sources}), onToken(text), onDone({index}), onError(message)
 * Returns when the stream ends. Pass an AbortSignal to stop generating.
 */
export async function streamChat({ message, conversationId, scanId }, handlers, signal) {
  const res = await fetch(`${API}/chat`, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId, scanId }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'L’assistant est indisponible.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();
    for (const block of blocks) {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === 'meta') handlers.onMeta?.(data);
      else if (event === 'token') handlers.onToken?.(data.text);
      else if (event === 'done') handlers.onDone?.(data);
      else if (event === 'error') handlers.onError?.(data.error);
    }
  }
}

/** Questions proposed after a diagnosis */
export function suggestionsFor(scan) {
  if (!scan) return ['Comment reconnaître le mildiou ?', 'Comment prévenir les maladies des tomates ?', 'Quand faut-il consulter un agronome ?'];
  const d = scan.disease;
  if (scan.uncertain) return ['Comment prendre une meilleure photo ?', `Quels symptômes distinguent ${d.disease} ?`, 'Que faire en attendant un avis sûr ?'];
  if (d.is_healthy) return [`Comment garder mon plant de ${d.plant_species.toLowerCase()} en bonne santé ?`, 'Quelles maladies surveiller en ce moment ?', 'Quel arrosage recommandes-tu ?'];
  return [`Qu’est-ce que ${d.disease} ?`, 'Comment traiter sans risque ?', 'Est-ce contagieux pour mes autres plants ?', 'Comment éviter que ça revienne ?'];
}
