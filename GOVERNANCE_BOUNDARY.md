# Governed agent boundary

OPTRANE Command uses only OPTRANE-normalized agent routes. Provider-native governance endpoints and policy evaluation are server-side implementation details.

The desktop may display the governance provider name, passport ID, trust state, budget and evidence summary returned by OPTRANE. It never receives peer connection identifiers, client credentials, signing keys, nonces, signatures, provider access tokens, native policy payloads or provider endpoint URLs.

For manual backend peer setup, use the private `optrane-governance-admin` function and operator-held provider credentials. Those surfaces are not part of the desktop contract or this public repository.
