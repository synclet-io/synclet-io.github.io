---
title: Connector licenses
description: Synclet is MIT; the connectors it runs carry their own licenses. Most Airbyte connectors are under ELv2 since 2025-07-22, 51 remain MIT.
---

Synclet is MIT licensed. The connectors it runs are not part of Synclet: they are Docker images that you pull from their publishers, and each one carries its own license. Synclet does not ship, mirror or relicense any connector.

The default connector registry in Synclet is Airbyte's public OSS registry (`https://connectors.airbyte.com/files/registries/v0/oss_registry.json`). It is enabled by default, so the catalog is full on first start; you can remove it, or add your own registries, under [Settings](/synclet-site/docs/guides/settings/). Whichever images you run, their license terms apply to you, not to Synclet.

> This page is not legal advice. It summarizes public documents so you know what to read; for a decision that matters, read the licenses with your own counsel.

## Most Airbyte connectors are ELv2 since 2025-07-22

On 2025-07-22 Airbyte moved most of its connectors from MIT to the [Elastic License 2.0 (ELv2)](https://www.elastic.co/licensing/elastic-license). The current registry entry shows a connector's license today; to see the license an older image version was published under, check the `license` field of `metadata.yaml` at that version in the airbyte repository.

The registry snapshot of 2026-10-17 (the `license` field of every entry):

| | Total | ELv2 | MIT | Airbyte Enterprise |
|---|---|---|---|---|
| Sources | 590 | 548 | 36 | 6 |
| Destinations | 54 | 39 | 15 | 0 |
| **All** | **644** | **587** | **51** | **6** |

To check one connector, look at its `license` in the registry JSON, or at the `license` field of the connector's `metadata.yaml` in the [airbyte repository](https://github.com/airbytehq/airbyte/tree/master/airbyte-integrations/connectors).

## What ELv2 allows

ELv2 grants the right to "use, copy, distribute, make available, and prepare derivative works of the software". In practice, per [Airbyte's license FAQ](https://docs.airbyte.com/community/licenses/license-faq):

- Running ELv2 connectors on your own infrastructure, free of charge, with no limit on volume, users or connections.
- Commercial use inside your business, including syncing data your company needs from its customers' systems.
- Building your internal data stack on them, with your team configuring pipelines through a UI or an API.
- Building a product on top, such as an analytics platform that brings data in on behalf of your customers, as long as the customers get no direct access to the connector functionality.
- Modifying the connectors and running the modified versions, within the limits below.

## What ELv2 forbids

ELv2 has three limitations. You cannot:

- **Provide the software to others as a managed service.** Airbyte's FAQ names two examples: hosting it yourself and selling it as an ELT/ETL tool or a replacement for the Airbyte solution, and selling a product that directly exposes its UI or API.
- **Circumvent license key functionality** or remove or obscure features protected by license keys.
- **Remove or obscure** any licensing, copyright or other notices.

## Running Synclet for other people

Synclet's workspaces, RBAC, per-workspace secrets and audit log are built for internal multi-team installs: several teams of one organization sharing one Synclet.

Synclet makes no promise that you may run ELv2 connectors as a sync service for clients. Whether a given agency or multi-tenant setup falls under the "managed service" limitation depends on its details; a legal read of ELv2 for that case is pending and this page will link it once it exists. Until then, read ELv2 and Airbyte's FAQ with your own counsel, or use connectors whose license allows it: the MIT connectors below, Synclet's own [Go connectors](https://github.com/synclet-io/connectors) (MIT), or connectors you write yourself.

## "Airbyte Enterprise" connectors

Six registry entries carry the license "Airbyte Enterprise": `source-db2-enterprise`, `source-netsuite-enterprise`, `source-oracle-enterprise`, `source-sap-hana-enterprise`, `source-sharepoint-enterprise` and `source-sharepoint-lists-enterprise`. They need a commercial agreement with Airbyte; Synclet does not provide one.

## Connectors that remain MIT

As of the snapshot of 2026-10-17, 51 connectors remain MIT. Of the sources, `source-service-now`, `source-workday` and `source-workday-rest` are certified; every other MIT entry is at community support level.

**Sources (36):** `source-activecampaign`, `source-acuity-scheduling`, `source-adjust`, `source-adobe-commerce-magento`, `source-aha`, `source-amazon-sqs`, `source-auth0`, `source-avni`, `source-aws-cloudtrail`, `source-bamboo-hr`, `source-gridly`, `source-harness`, `source-hubplanner`, `source-intruder`, `source-jina-ai-reader`, `source-mantle`, `source-metricool`, `source-nexus-datasets`, `source-perk`, `source-pingdom`, `source-plaid`, `source-postmarkapp`, `source-recreation`, `source-recruitee`, `source-reply-io`, `source-rki-covid`, `source-rss`, `source-salesloft`, `source-senseforce`, `source-serpstat`, `source-service-now`, `source-shiftbase`, `source-stigg`, `source-ticktick`, `source-workday`, `source-workday-rest`.

**Destinations (15):** `destination-aws-datalake`, `destination-csv`, `destination-dynamodb`, `destination-elasticsearch`, `destination-firestore`, `destination-hubspot`, `destination-kafka`, `destination-local-json`, `destination-pubsub`, `destination-rabbitmq`, `destination-redis`, `destination-s3-glue`, `destination-sqlite`, `destination-starburst-galaxy`, `destination-teradata`.

Licenses change: check the registry before you rely on this list.

## The Airbyte Protocol and Synclet

Synclet talks to connectors through the [Airbyte Protocol](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol), whose specification is published in the [airbyte-protocol repository](https://github.com/airbytehq/airbyte-protocol) under the MIT license ([LICENSE](https://github.com/airbytehq/airbyte-protocol/blob/main/LICENSE)). Synclet contains no Airbyte platform code. See [Connectors](/synclet-site/docs/concepts/connectors/) for how connectors run and which ones are tested.

Airbyte is a trademark of Airbyte, Inc. Synclet is not affiliated with, endorsed by or sponsored by Airbyte, Inc.
