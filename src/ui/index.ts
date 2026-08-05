/**
 * Public entry point of the `src/ui` design system (RFC-0005 §6). Only re-exports what is meant to
 * be a stable, cross-route API — components and their prop types, never MUI internals.
 */

export type {
    PresentationContextValue,
    PresentationProviderProps
} from './presentation/PresentationContext';
export {
    PresentationProvider,
    usePresentation,
    usePresentationContext
} from './presentation/PresentationContext';
export type { EmptyStateProps } from './components/states/EmptyState';
export { EmptyState } from './components/states/EmptyState';
export type { ErrorStateProps } from './components/states/ErrorState';
export { ErrorState } from './components/states/ErrorState';
export type {
    LoadingStateProps,
    LoadingStateVariant
} from './components/states/LoadingState';
export { LoadingState } from './components/states/LoadingState';
export type {
    FloatingSidebarItem,
    FloatingSidebarProps
} from './components/FloatingSidebar/FloatingSidebar';
export { FloatingSidebar } from './components/FloatingSidebar/FloatingSidebar';
export type {
    MediaCardImageAspect,
    MediaCardProps
} from './components/MediaCard/MediaCard';
export { MediaCard } from './components/MediaCard/MediaCard';
export type { MediaGridProps } from './components/MediaGrid/MediaGrid';
export { MediaGrid } from './components/MediaGrid/MediaGrid';
export type { MediaShelfProps } from './components/MediaShelf/MediaShelf';
export { MediaShelf } from './components/MediaShelf/MediaShelf';
export type { PaginationProps } from './components/Pagination/Pagination';
export { Pagination } from './components/Pagination/Pagination';
export type {
    SortSelectOption,
    SortSelectProps
} from './components/SortSelect/SortSelect';
export { SortSelect } from './components/SortSelect/SortSelect';
export type {
    SurfaceProps,
    SurfaceVariant
} from './components/Surface/Surface';
export { Surface } from './components/Surface/Surface';
export type { TabItem, TabsProps } from './components/Tabs/Tabs';
export { Tabs } from './components/Tabs/Tabs';
