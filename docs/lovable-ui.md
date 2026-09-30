# Lovable UI design integration

The Gather workspace uses the visual direction from the private, fictional-data
[Gather Insights UI design project](https://lovable.dev/projects/bc88da5c-0289-44c6-a41e-01dfc15dd551).
Design reference commit: `4298b009f4ea98175fd4d392b33e8be3466e11fb`.

The prototype is a design reference, not the production app or a continuously
synchronized copy. It has no Gather credentials, user data, backend, or auth.
Do not replace the real workspace with its mock components.

## Ported into the real product

- Neutral surfaces, forest-green actions, system typography, compact spacing.
- Plan / Event / Review navigation and a joined project-summary strip.
- Right-side task sheet, with existing owner actions and collapsed organizer controls.
- Task cards on narrow screens and consistent email change comparisons.

`legacy/lovable-ui.css` holds the adapted visual layer. `scripts/prepare.mjs`
ships it to the authenticated workspace and the full-product demo. Edit source
under `legacy`, not generated `public/gather-assets` files.

The existing 800px navigation breakpoint is intentional: it matches the app's
keyboard focus and inert-state logic. All existing task fields remain available,
including the latest update column. No API, data model, authorization, attendee
messaging, or email approval behavior is changed by this design integration.

## Dark mode

`legacy/theme.js` initializes the appearance before the workspace paints. The
same script also runs in the React shell for Gmail/settings. It follows the
device preference until an explicit light/dark choice is saved in the browser's
`gather-theme` key; `GatherTheme.set('system')` restores automatic behavior.
Storage changes synchronize other tabs and the workspace iframe. Theme changes
do not rerender the workspace or discard form drafts. If storage is blocked,
the switch continues to work for the current page.

The legacy palette uses `--muted` for text and `--white` for raised surfaces;
the React/shadcn palette uses `--muted` for a surface. Keep these mappings
distinct when updating both dark palettes.
