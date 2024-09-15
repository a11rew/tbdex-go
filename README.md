# tbDEX Go

Send money across borders without internet access, powered by tbDex.

## Overview

tbDEX Go is a mobile application that allows users to send money across borders without internet access. It is powered by tbDex, a decentralized exchange protocol that allows for peer-to-peer financial transactions without intermediaries.

tbDEX Go is accessible via USSD (Unstructured Supplementary Service Data), a GSM protocol that is used to send and receive messages from mobile phones without using the internet.

Using USSD allows tbDEX Go to be accessible to our target market of users in Sub-Saharan Africa who have limited or no internet access but have easy access to a mobile phone and need to send and receive money.

Mobile phone penetration in Sub-Saharan Africa is high, with over 1.3 billion mobile phone subscriptions and 60% of the global mobile phone market. Internet service provision however, badly lags behind with unreliable internet access and high costs.

## Try it out

You can try out the tbDEX Go USSD service visiting this [USSD Simulator](https://developer.africastalking.com/ussd/sandbox).

You then dial \*384\*05040# from the "Phone" app to access the service.

## Technical Overview

tbDEX Go is built to work on Cloudflare Workers.

Requests to the tbDEX Go USSD service are routed to a Cloudflare Worker via the AfricasTalking USSD gateway. The worker handles the request, processes the transaction, and sends the response back to the AfricasTalking USSD gateway which then delivers it to the user's mobile phone.

We create DIDs for users, associated with their phone numbers and store them in a key manager. We interact with the tbDEX network on behalf of users with the aforementioned DIDs to send RFQ's, place orders and more.

We use SMS powered by AfricasTalking to send notifications to users. These SMS communications are bi-directional and allow users to do things like complete orders and rate PFI's outside of the USSD flow.

### Stack

- [Cloudflare Workers (with KV and D1)](https://developers.cloudflare.com/workers/)
- [tbDEX](https://github.com/tbdex/tbdex)
- [AfricasTalking (SMS and USSD provider)](https://africastalking.com/)
- [TypeScript](https://www.typescriptlang.org/)

## Future Roadmap

- [ ] DID Imports and Exports
