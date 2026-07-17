import type { BaseItemDto as ReefinBaseItemDto } from 'lib/reefin-sdk';
import type { ItemDto } from 'types/base/models/item-dto';

/**
 * `apps/modern/features/home`'s data layer (`api/use*.ts`) returns `reefin-sdk`'s generated
 * `BaseItemDto`, while the shared card-rendering stack (`SectionContainer`, `Cards`,
 * `types/cardOptions`) expects `types/base/models/item-dto`'s `ItemDto` - a hand-widened superset
 * of `@jellyfin/sdk`'s `BaseItemDto` (see that file's `Omit<...>` construction). Both DTOs are
 * generated from the same Jellyfin-derived wire format; the only practical difference is which
 * sibling package's string-literal enums (`BaseItemKind`, `CollectionType`, ...) populate fields
 * like `Type`/`CollectionType`, and those unions are structurally identical strings. Rather than
 * writing a field-by-field mapper that would just be a very long identity function, this module is
 * the single, deliberate, commented place where that structural equivalence is asserted via a
 * cast - every other file under `features/home` should import items already-adapted from here
 * instead of reaching for `as` itself.
 */
export const toItemDto = (item: ReefinBaseItemDto): ItemDto =>
    item as unknown as ItemDto;

export const toItemDtoArray = (items?: ReefinBaseItemDto[] | null): ItemDto[] =>
    (items ?? []).map(toItemDto);
