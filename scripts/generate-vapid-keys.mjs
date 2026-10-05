#!/usr/bin/env node
/**
 * Prints a free Web Push key pair (VAPID). Set both on the server / in Vercel:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT=mailto:you@example.com
 * Generate once; changing them later means every phone has to allow
 * notifications again.
 */
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('VAPID_SUBJECT=mailto:you@example.com   # your contact address')
console.log('\nKeep the private key secret (server only).')
