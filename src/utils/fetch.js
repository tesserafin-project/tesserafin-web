import { endpointCategory } from './urlCategory';

/**
 * #75 / S4 - this module used to print the full url on six paths, request and response alike.
 * `getFetchPromise` appends the query string before handing the url on, and an api-client request
 * can carry `api_key`/`ApiKey`, so those lines published the caller's session credential. They now
 * name the endpoint category, the HTTP method and the status instead: enough to see what the
 * client is doing, with nothing of what it is authenticating with.
 */
export function getFetchPromise(request) {
    const headers = request.headers || {};

    if (request.dataType === 'json') {
        headers.accept = 'application/json';
    }

    const fetchRequest = {
        headers: headers,
        method: request.type,
        credentials: 'same-origin'
    };

    let contentType = request.contentType;

    if (request.data) {
        if (typeof request.data === 'string') {
            fetchRequest.body = request.data;
        } else {
            fetchRequest.body = paramsToString(request.data);

            contentType =
                contentType ||
                'application/x-www-form-urlencoded; charset=UTF-8';
        }
    }

    if (contentType) {
        headers['Content-Type'] = contentType;
    }

    let url = request.url;

    if (request.query) {
        const paramString = paramsToString(request.query);
        if (paramString) {
            url += `?${paramString}`;
        }
    }

    if (!request.timeout) {
        return fetch(url, fetchRequest);
    }

    return fetchWithTimeout(url, fetchRequest, request.timeout);
}

function fetchWithTimeout(url, options, timeoutMs) {
    const endpoint = endpointCategory(url);
    console.debug(
        `fetchWithTimeout: timeoutMs: ${timeoutMs}, endpoint: ${endpoint}`
    );

    return new Promise(function (resolve, reject) {
        const timeout = setTimeout(reject, timeoutMs);

        options = options || {};
        options.credentials = 'same-origin';

        fetch(url, options).then(
            function (response) {
                clearTimeout(timeout);

                console.debug(
                    `fetchWithTimeout: succeeded connecting to endpoint: ${endpoint}`
                );

                resolve(response);
            },
            function (error) {
                clearTimeout(timeout);

                console.debug(
                    `fetchWithTimeout: timed out connecting to endpoint: ${endpoint}`
                );

                reject(error);
            }
        );
    });
}

/**
 * @param params {Record<string, string | number | boolean>}
 * @returns {string} Query string
 */
function paramsToString(params) {
    return Object.entries(params)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

export function ajax(request) {
    if (!request) {
        throw new Error('Request cannot be null');
    }

    request.headers = request.headers || {};

    const method = request.type || 'GET';
    const endpoint = endpointCategory(request.url);
    console.debug(`requesting ${method} endpoint: ${endpoint}`);

    return getFetchPromise(request).then(
        function (response) {
            console.debug(
                `response status: ${response.status}, ${method} endpoint: ${endpoint}`
            );
            if (response.status < 400) {
                if (
                    request.dataType === 'json' ||
                    request.headers.accept === 'application/json'
                ) {
                    return response.json();
                } else if (
                    request.dataType === 'text' ||
                    (response.headers.get('Content-Type') || '')
                        .toLowerCase()
                        .startsWith('text/')
                ) {
                    return response.text();
                } else {
                    return response;
                }
            } else {
                return Promise.reject(response);
            }
        },
        function (err) {
            console.error(`request failed: ${method} endpoint: ${endpoint}`);
            throw err;
        }
    );
}
