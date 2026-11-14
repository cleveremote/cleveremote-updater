import { ValidationError } from '@nestjs/common';
import { ErrorCode } from './error-code';
import { ValidationExceptionFactory } from './validation-exception.factory';

describe('ValidationExceptionFactory', () => {
    it('returns 400 VALIDATION_FAILED with each field path (nested included) and its failed constraints', () => {
        const errors = [
            { property: 'psk', constraints: { isLength: 'psk must be longer than or equal to 8 characters' }, children: [] },
            {
                property: 'localCoordinates',
                children: [{ property: 'latitude', constraints: { isNumber: '...', isLatitude: '...' }, children: [] }]
            }
        ] as ValidationError[];

        const exception = ValidationExceptionFactory(errors);

        expect(exception.getStatus()).toBe(400);
        expect(exception.getResponse()).toEqual({
            statusCode: 400,
            code: ErrorCode.VALIDATION_FAILED,
            message: 'invalid request: psk, localCoordinates.latitude',
            details: {
                fields: [
                    { field: 'psk', constraints: ['isLength'] },
                    { field: 'localCoordinates.latitude', constraints: ['isNumber', 'isLatitude'] }
                ]
            }
        });
    });
});
