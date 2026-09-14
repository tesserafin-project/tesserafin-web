/*
 * The wizard's route layout, reached only through `lazy: () => import('../AppLayout')` in
 * `./routes/routes.tsx`. It is the legacy layout plus the one stylesheet the first run needs, and it
 * exists so that stylesheet sits behind the route boundary instead of in the initial delivery (#145).
 */
import './wizardMaterial.scss';

export { default as Component } from 'apps/legacy/AppLayout';
