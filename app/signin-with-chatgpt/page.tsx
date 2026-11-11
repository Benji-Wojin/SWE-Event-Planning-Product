import { redirect } from 'next/navigation';
import { safeAuthRedirect, safeRelativeReturnPath } from '@/auth';
import { SIGN_IN_PATH } from '@/lib/auth-paths';

export const dynamic = 'force-dynamic';

export default async function LegacySignInPage({searchParams}:{
  searchParams:Promise<{return_to?:string;callbackUrl?:string;error?:string}>;
}) {
  const params=await searchParams;
  const query=new URLSearchParams();
  if(typeof params.return_to==='string') query.set('return_to',safeRelativeReturnPath(params.return_to));
  else if(typeof params.callbackUrl==='string') query.set('callbackUrl',safeAuthRedirect(params.callbackUrl));
  if(typeof params.error==='string'&&params.error) query.set('error','1');
  redirect(query.size ? SIGN_IN_PATH+'?'+query : SIGN_IN_PATH);
}
