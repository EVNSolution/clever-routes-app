import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

/** App-private durable files survive cache eviction and in-place app updates. Never delete pending evidence on launch. */
export async function retainProofFile(uri: string, kind: 'photo' | 'signature'): Promise<string> {
  const directory = new Directory(Paths.document, 'delivery-proof');
  directory.create({ idempotent: true, intermediates: true });
  if (uri.startsWith(`${directory.uri}/`)) return uri;
  const extension = kind === 'signature' || /\.png(?:\?|$)/iu.test(uri) ? 'png' : 'jpg';
  const target = new File(directory, `${kind}-${Crypto.randomUUID()}.${extension}`);
  await new File(uri).copy(target);
  if (!target.exists || target.size <= 0) throw new Error('Delivery proof could not be saved on this device.');
  return target.uri;
}
