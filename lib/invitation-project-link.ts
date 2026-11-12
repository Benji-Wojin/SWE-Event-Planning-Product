/** Keep the join receipt out of the project URL. The welcome hint only affects presentation. */
export function invitationProjectHref(projectId: string, newlyJoined: boolean) {
  return '/project?project=' + encodeURIComponent(projectId) + (newlyJoined ? '&welcome=1' : '');
}
