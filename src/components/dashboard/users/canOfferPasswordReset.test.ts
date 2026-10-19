import { describe, expect, it } from 'vitest';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client';
import { canOfferPasswordReset } from './canOfferPasswordReset';

const admin = { Policy: { IsAdministrator: true } } as UserDto;
const ordinary = {
    HasConfiguredPassword: true,
    Policy: { IsAdministrator: false }
} as UserDto;

describe('canOfferPasswordReset', () => {
    it('offers an administrator the reset of an ordinary account', () => {
        expect(canOfferPasswordReset(admin, ordinary)).toBe(true);
    });

    it('never offers an ordinary user the reset of their own account', () => {
        expect(canOfferPasswordReset(ordinary, ordinary)).toBe(false);
    });

    it('never offers the reset of an administrator account', () => {
        expect(
            canOfferPasswordReset(admin, {
                ...admin,
                HasConfiguredPassword: true
            })
        ).toBe(false);
    });

    it('never offers the reset of an account without a credential', () => {
        expect(
            canOfferPasswordReset(admin, {
                ...ordinary,
                HasConfiguredPassword: false
            })
        ).toBe(false);
    });

    it('never offers the reset when the signed-in user is unknown', () => {
        expect(canOfferPasswordReset(null, ordinary)).toBe(false);
    });
});
