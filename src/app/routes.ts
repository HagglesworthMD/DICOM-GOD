/**
 * Routes configuration - single route for now
 * Prepared for future expansion (multi-study, comparison views, etc.)
 */

export interface Route {
    path: string;
    name: string;
    component: 'viewer' | 'settings' | 'about';
}

export const routes: Route[] = [
    {
        path: '/',
        name: 'Viewer',
        component: 'viewer',
    },
    // Future routes:
    // { path: '/settings', name: 'Settings', component: 'settings' },
    // { path: '/about', name: 'About', component: 'about' },
];

export function matchRoute(pathname: string): Route | undefined {
    return routes.find((r) => r.path === pathname);
}
