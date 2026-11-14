import { BadRequestException, HttpStatus, ValidationError } from '@nestjs/common';
import { ErrorCode, ErrorBody } from './error-code';

export interface FieldError {
    // chemin complet, ex. "localCoordinates.latitude"
    field: string;
    // noms des contraintes class-validator en échec, ex. ["isLength"], à traduire côté front
    constraints: string[];
}

function Flatten(errors: ValidationError[], parent = ''): FieldError[] {
    return errors.flatMap((error) => {
        const field = parent ? `${parent}.${error.property}` : error.property;
        const own = error.constraints ? [{ field, constraints: Object.keys(error.constraints) }] : [];
        return [...own, ...Flatten(error.children ?? [], field)];
    });
}

// exceptionFactory du ValidationPipe global : même forme d'erreur que le reste de l'API
export function ValidationExceptionFactory(errors: ValidationError[]): BadRequestException {
    const fields = Flatten(errors);
    return new BadRequestException(ErrorBody(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `invalid request: ${fields.map((error) => error.field).join(', ')}`,
        { fields }
    ));
}
