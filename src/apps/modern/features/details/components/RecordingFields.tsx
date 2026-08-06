import React, { useEffect, useRef, type FC } from 'react';

import type { DetailItem } from '../adapters/itemDetailsApi';

interface LegacyRecordingFields {
    destroy?: () => void;
    refresh?: () => void;
}

/**
 * The live-TV recording controls for a programme.
 *
 * A TEMPORARY imperative adapter, and the only one in the migrated slice. `components/recordingcreator/recordingfields`
 * has no modern React equivalent, and reimplementing the recording editor is a different piece of
 * work from migrating this route. Phase 6 permits an adapter on four conditions, all met here:
 *
 *   - React owns the lifecycle — it is constructed in an effect and torn down in its cleanup;
 *   - the teardown is explicit. `SUSPECT` #13 records that the legacy route NEVER destroyed this
 *     widget (it only nulled its own reference on `viewdestroy`), so an embed-without-destroy
 *     lifecycle leaked one per visit. Delta D8;
 *   - it creates no React root — it writes into a DOM node React already owns;
 *   - it exposes no selector as theme API. Nothing styles `data-detail-section="recordingFields"`,
 *     and the widget's own classes are not published.
 *
 * The widget issues the `getLiveTvProgram` read the frozen contract records for the `program`
 * class, so keeping it also keeps that class's read inventory intact.
 */
const RecordingFields: FC<{ item: DetailItem }> = ({ item }) => {
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const parent = host.current;
        if (!parent) return;

        let instance: LegacyRecordingFields | null = null;
        let cancelled = false;

        void import('components/recordingcreator/recordingfields').then(
            ({ default: Fields }) => {
                if (cancelled || !host.current) return;
                instance = new Fields({
                    parent,
                    programId: item.Id,
                    serverId: item.ServerId
                }) as LegacyRecordingFields;
            }
        );

        return () => {
            cancelled = true;
            instance?.destroy?.();
            instance = null;
            if (parent) parent.innerHTML = '';
        };
    }, [item]);

    return <div ref={host} />;
};

export default RecordingFields;
