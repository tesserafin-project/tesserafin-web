import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { useApi } from 'hooks/useApi';
import { plainCardNavigation } from 'apps/modern/utils/mediaCardNavigation';
import {
    forgetHomePosition,
    homeReturnKey,
    rememberHomePosition,
    restoreHomePosition,
    readHomePosition
} from '../utils/homeReturnPosition';

/** One return per history entry; a refetch must never pull the viewer back again. */
export function useHomeReturnPosition(tab: number) {
    const { user } = useApi();
    const location = useLocation();
    const navigate = useNavigate();
    const navigation = useNavigationType();
    const fetching = useIsFetching({ queryKey: ['Home', user?.Id] });
    const root = useRef<HTMLDivElement>(null);
    const key = homeReturnKey(
        user?.ServerId ?? '',
        user?.Id ?? '',
        tab,
        location.key
    );
    const pending = useRef<{
        key: string;
        saved: ReturnType<typeof readHomePosition>;
    }>();
    if (pending.current?.key !== key) {
        const saved = readHomePosition(key);
        pending.current = {
            key,
            saved: navigation === 'POP' ? saved : undefined
        };
    }

    useEffect(() => {
        const container = root.current;
        if (!container || !user?.Id || !user.ServerId) return;
        const remember = (event: MouseEvent) => {
            const target = plainCardNavigation(event, container);
            if (!target) return;
            const { card, href } = target;
            rememberHomePosition(key, container, card);
            // Use the router for Home's card links: native hash changes have no unique history
            // key and look like POP even when creating an entry. Modified/new-tab clicks stay native.
            event.preventDefault();
            navigate(href.slice(1));
        };
        container.addEventListener('click', remember);
        return () => container.removeEventListener('click', remember);
    }, [key, navigate, user?.Id, user?.ServerId]);

    useEffect(() => {
        const cancel = () => {
            if (pending.current) pending.current.saved = undefined;
            forgetHomePosition(key);
        };
        // If the viewer starts doing something while data arrives, recovery loses ownership.
        for (const type of [
            'pointerdown',
            'keydown',
            'wheel',
            'touchstart',
            'focusin'
        ])
            window.addEventListener(type, cancel, {
                capture: true,
                passive: true
            });
        return () => {
            for (const type of [
                'pointerdown',
                'keydown',
                'wheel',
                'touchstart',
                'focusin'
            ])
                window.removeEventListener(type, cancel, true);
        };
    }, [key]);

    useEffect(() => {
        if (fetching || !pending.current?.saved) return;
        const frame = requestAnimationFrame(() => {
            const container = root.current;
            const saved = pending.current?.saved;
            if (
                !container ||
                !saved ||
                container.querySelector('[data-rf-slot="state-loading"]')
            )
                return;
            pending.current!.saved = undefined;
            forgetHomePosition(key);
            restoreHomePosition(container, saved);
        });
        return () => cancelAnimationFrame(frame);
    }, [key, fetching]);

    return root;
}
