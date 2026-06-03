export function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error
    ) {
        return String((error as { message: unknown }).message);
    }
    return 'Unknown error';
}
