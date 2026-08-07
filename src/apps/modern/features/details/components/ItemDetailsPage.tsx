import React, { useMemo, type FC } from 'react';

import globalize from 'lib/globalize';
import { ErrorState, LoadingState } from 'ui';

import { useItemDetailsPrimary } from '../api/useItemDetails';
import { parseDetailsRouteParams } from '../utils/routeParams';
import ItemDetailsView from './ItemDetailsView';

interface ItemDetailsPageProps {
    searchParams: Pick<URLSearchParams, 'get'>;
}

/**
 * The route's state machine: loading, malformed route, request failure, or the page.
 *
 * Three of the four outcomes are the migration's answer to two frozen defects:
 *
 *   - `SUSPECT` #1 — a `/details` URL with no recognised parameter threw synchronously past its own
 *     `.catch`, leaving a permanent spinner. Here it is a bounded error state and the loading
 *     indicator is gone. Delta D2.
 *   - `SUSPECT` #2 — a failed primary read rendered nothing, showed no error and never hid the
 *     spinner. Here it is an explicit error. Delta D3.
 *
 * `MUST PRESERVE` #10 still holds on the success path: a failed primary read leaves no
 * plausible-looking stale page, because there is no page until the read resolves.
 */
const ItemDetailsPage: FC<ItemDetailsPageProps> = ({ searchParams }) => {
    const params = useMemo(
        () => parseDetailsRouteParams(searchParams),
        [searchParams]
    );

    const primary = useItemDetailsPrimary(params);

    if (params.kind === null) {
        return (
            <ErrorState
                title={globalize.translate('HeaderError')}
                message={globalize.translate('MessageInvalidUrl')}
            />
        );
    }

    if (primary.isPending) {
        return (
            <LoadingState
                variant='block'
                label={globalize.translate('Loading')}
            />
        );
    }

    if (primary.isError || !primary.data) {
        return (
            <ErrorState
                title={globalize.translate('HeaderError')}
                message={globalize.translate('MessageUnableToConnectToServer')}
                retryLabel={globalize.translate('Retry')}
                onRetry={() => void primary.refetch()}
            />
        );
    }

    return (
        <ItemDetailsView
            item={primary.data.item}
            user={primary.data.user}
            params={params}
        />
    );
};

export default ItemDetailsPage;
