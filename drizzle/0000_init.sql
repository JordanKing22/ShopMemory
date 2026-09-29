CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`display_name` text NOT NULL,
	`job_title` text NOT NULL,
	`department` text NOT NULL,
	`app_role` text NOT NULL,
	`cohort` text NOT NULL,
	`hire_date` text NOT NULL,
	`prior_experience_years` real DEFAULT 0 NOT NULL,
	`planned_departure_date` text,
	`departure_kind` text,
	`is_knowledge_holder` integer DEFAULT true NOT NULL,
	`bio_md` text,
	`redaction_aliases` text NOT NULL,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `people_role_idx` ON `people` (`app_role`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`role` text NOT NULL,
	`person_id` text,
	`redaction_aliases` text NOT NULL,
	`is_default_for_role` integer DEFAULT false NOT NULL,
	`show_in_switcher` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personas_default_role_uq` ON `personas` (`role`) WHERE "personas"."is_default_for_role" = 1;--> statement-breakpoint
CREATE TABLE `shop_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`employee_count` integer NOT NULL,
	`certifications` text NOT NULL,
	`demo_today` text NOT NULL,
	`seed` integer NOT NULL,
	`seed_bundle_hash` text NOT NULL,
	`fictional_notice` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `customer_accounts` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`contact_name` text,
	`contact_email` text,
	`payment_terms` text,
	`annual_spend_usd` integer,
	`pricing_notes_md` text,
	`classification` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "customer_accounts_classification_ck" CHECK("customer_accounts"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`industry` text NOT NULL,
	`segment` text,
	`customer_since` text NOT NULL,
	`is_new_customer` integer NOT NULL,
	`part_classification_floor` text NOT NULL,
	`quality_requirements_md` text,
	`redaction_aliases` text NOT NULL,
	`part_number_pattern` text NOT NULL,
	`sort_order` integer NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	CONSTRAINT "customers_classification_ck" CHECK("customers"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_tag` text NOT NULL,
	`name` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`kind` text NOT NULL,
	`year_installed` integer NOT NULL,
	`acquired` text NOT NULL,
	`location_cell` text,
	`status` text DEFAULT 'running' NOT NULL,
	`capabilities` text NOT NULL,
	`unit_history_md` text,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machines_asset_tag_unique` ON `machines` (`asset_tag`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`family` text NOT NULL,
	`aliases` text NOT NULL,
	`notes_md` text,
	`sort_order` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_number` text NOT NULL,
	`quote_id` text,
	`part_id` text NOT NULL,
	`status` text NOT NULL,
	`started_on` text,
	`shipped_on` text,
	`lead_person_id` text,
	`actual_machine_id` text,
	`actual_setup_hours` real,
	`actual_run_hours` real,
	`actual_hours` real,
	`variance_pct` real,
	`scrap_qty` integer DEFAULT 0 NOT NULL,
	`ncr_count` integer DEFAULT 0 NOT NULL,
	`on_time` integer,
	`debrief_md` text,
	`is_anchor` integer DEFAULT false NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actual_machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "jobs_classification_ck" CHECK("jobs"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_job_number_unique` ON `jobs` (`job_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_quote_id_unique` ON `jobs` (`quote_id`);--> statement-breakpoint
CREATE INDEX `jobs_part_idx` ON `jobs` (`part_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_variance_idx` ON `jobs` (`variance_pct`);--> statement-breakpoint
CREATE TABLE `machine_events` (
	`id` text PRIMARY KEY NOT NULL,
	`machine_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`job_id` text,
	`person_id` text,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "machine_events_classification_ck" CHECK("machine_events"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE INDEX `machine_events_machine_idx` ON `machine_events` (`machine_id`,`occurred_on`);--> statement-breakpoint
CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`part_number` text NOT NULL,
	`revision` text NOT NULL,
	`description` text NOT NULL,
	`family` text NOT NULL,
	`material_id` text NOT NULL,
	`features` text NOT NULL,
	`min_wall_in` real,
	`max_wall_height_in` real,
	`tightest_tol_in` real,
	`envelope_in` text,
	`complexity` integer NOT NULL,
	`export_control` text DEFAULT 'none' NOT NULL,
	`is_anchor` integer DEFAULT false NOT NULL,
	`notes_md` text,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "parts_complexity_ck" CHECK("parts"."complexity" between 1 and 5),
	CONSTRAINT "parts_classification_ck" CHECK("parts"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parts_pn_uq` ON `parts` (`customer_id`,`part_number`,`revision`);--> statement-breakpoint
CREATE INDEX `parts_customer_idx` ON `parts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `parts_material_idx` ON `parts` (`material_id`);--> statement-breakpoint
CREATE INDEX `parts_class_idx` ON `parts` (`classification`);--> statement-breakpoint
CREATE TABLE `quote_financials` (
	`quote_id` text PRIMARY KEY NOT NULL,
	`shop_rate_usd_per_hr` real NOT NULL,
	`material_cost_usd` real NOT NULL,
	`outside_processing_usd` real NOT NULL,
	`risk_adder_hours` real NOT NULL,
	`scrap_allowance_pct` real NOT NULL,
	`unit_price_usd` real NOT NULL,
	`total_price_usd` real NOT NULL,
	`target_margin_pct` real NOT NULL,
	`classification` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quote_financials_classification_ck" CHECK("quote_financials"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_number` text NOT NULL,
	`part_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`quoted_on` text NOT NULL,
	`quoted_by_person_id` text NOT NULL,
	`qty` integer NOT NULL,
	`primary_machine_id` text NOT NULL,
	`secondary_machine_id` text,
	`quoted_setup_hours` real NOT NULL,
	`quoted_cycle_minutes` real NOT NULL,
	`quoted_hours` real NOT NULL,
	`lead_time_days` integer,
	`outcome` text NOT NULL,
	`lost_reason` text,
	`judgment_drivers` text NOT NULL,
	`quoter_notes_md` text,
	`is_anchor` integer DEFAULT false NOT NULL,
	`search_title` text NOT NULL,
	`search_text` text NOT NULL,
	`search_tags` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quoted_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`secondary_machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quotes_classification_ck" CHECK("quotes"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_quote_number_unique` ON `quotes` (`quote_number`);--> statement-breakpoint
CREATE INDEX `quotes_part_idx` ON `quotes` (`part_id`);--> statement-breakpoint
CREATE INDEX `quotes_cust_date_idx` ON `quotes` (`customer_id`,`quoted_on`);--> statement-breakpoint
CREATE INDEX `quotes_outcome_idx` ON `quotes` (`outcome`);--> statement-breakpoint
CREATE INDEX `quotes_quoter_idx` ON `quotes` (`quoted_by_person_id`);--> statement-breakpoint
CREATE TABLE `person_topic_expertise` (
	`person_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`tacit_level` integer NOT NULL,
	`assessed_by` text NOT NULL,
	`assessed_on` text NOT NULL,
	`note` text,
	PRIMARY KEY(`person_id`, `topic_id`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pte_level_ck" CHECK("person_topic_expertise"."tacit_level" between 0 and 3)
);
--> statement-breakpoint
CREATE INDEX `pte_topic_idx` ON `person_topic_expertise` (`topic_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`topic_id` text,
	`synonyms` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`machine_id` text,
	`material_id` text,
	`customer_id` text,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "topics_entity_ck" CHECK(("topics"."category" = 'process' and "topics"."machine_id" is null and "topics"."material_id" is null and "topics"."customer_id" is null)
       or ("topics"."category" = 'machine' and "topics"."machine_id" is not null and "topics"."material_id" is null and "topics"."customer_id" is null)
       or ("topics"."category" = 'material' and "topics"."material_id" is not null and "topics"."machine_id" is null and "topics"."customer_id" is null)
       or ("topics"."category" = 'customer' and "topics"."customer_id" is not null and "topics"."machine_id" is null and "topics"."material_id" is null))
);
--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`person_id` text NOT NULL,
	`consent_text_version` text NOT NULL,
	`consent_text_sha256` text NOT NULL,
	`speech_engine_disclosed` text NOT NULL,
	`ai_mode` text NOT NULL,
	`target_class` text NOT NULL,
	`endpoint_host` text NOT NULL,
	`granted` integer NOT NULL,
	`granted_at` text NOT NULL,
	`recorded_by_persona_id` text,
	`mode` text DEFAULT 'self' NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_records_interview_id_unique` ON `consent_records` (`interview_id`);--> statement-breakpoint
CREATE TABLE `interview_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`seq` integer NOT NULL,
	`speaker` text NOT NULL,
	`phase` text,
	`move` text,
	`text` text NOT NULL,
	`text_source` text NOT NULL,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "interview_turns_classification_ck" CHECK("interview_turns"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `it_seq_uq` ON `interview_turns` (`interview_id`,`seq`);--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`plan` text DEFAULT 'generic' NOT NULL,
	`expert_person_id` text NOT NULL,
	`run_by_persona_id` text,
	`topic_id` text,
	`context_quote_id` text,
	`context_job_id` text,
	`context_part_id` text,
	`context_customer_id` text,
	`status` text NOT NULL,
	`phase` text,
	`tracker_state` text,
	`speech_engine` text DEFAULT 'typed' NOT NULL,
	`audio_retained` integer DEFAULT false NOT NULL,
	`script_key` text,
	`off_script` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`summary_md` text,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`expert_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_by_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`context_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interviews_no_audio_ck" CHECK("interviews"."audio_retained" = 0),
	CONSTRAINT "interviews_classification_ck" CHECK("interviews"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE INDEX `interviews_expert_idx` ON `interviews` (`expert_person_id`);--> statement-breakpoint
CREATE TABLE `quote_reasoning_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`interview_id` text,
	`person_id` text NOT NULL,
	`main_driver` text,
	`machine_rationale` text,
	`hours_rationale` text,
	`risk_priced_in` text,
	`risk_bucket` text,
	`what_would_change` text,
	`junior_would_miss` text,
	`confidence_1to5` integer,
	`variance_review_md` text,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qrl_conf_ck" CHECK("quote_reasoning_logs"."confidence_1to5" is null or "quote_reasoning_logs"."confidence_1to5" between 1 and 5),
	CONSTRAINT "quote_reasoning_logs_classification_ck" CHECK("quote_reasoning_logs"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `card_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`start_char` integer NOT NULL,
	`end_char` integer NOT NULL,
	`quote` text NOT NULL,
	`confidence_evidence` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `interview_turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ce_card_idx` ON `card_evidence` (`card_id`);--> statement-breakpoint
CREATE INDEX `ce_turn_idx` ON `card_evidence` (`turn_id`);--> statement-breakpoint
CREATE TABLE `card_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`kind` text NOT NULL,
	`job_id` text,
	`quote_id` text,
	`part_id` text,
	`machine_id` text,
	`material_id` text,
	`customer_id` text,
	`person_id` text,
	`mention` text,
	`link_basis` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "card_links_one_target_ck" CHECK((("card_links"."job_id" is not null) + ("card_links"."quote_id" is not null) + ("card_links"."part_id" is not null) + ("card_links"."machine_id" is not null)
        + ("card_links"."material_id" is not null) + ("card_links"."customer_id" is not null) + ("card_links"."person_id" is not null)) = 1
        and (("card_links"."kind" = 'job' and "card_links"."job_id" is not null) or ("card_links"."kind" = 'quote' and "card_links"."quote_id" is not null)
          or ("card_links"."kind" = 'part' and "card_links"."part_id" is not null) or ("card_links"."kind" = 'machine' and "card_links"."machine_id" is not null)
          or ("card_links"."kind" = 'material' and "card_links"."material_id" is not null) or ("card_links"."kind" = 'customer' and "card_links"."customer_id" is not null)
          or ("card_links"."kind" = 'person' and "card_links"."person_id" is not null)))
);
--> statement-breakpoint
CREATE INDEX `cl_card_idx` ON `card_links` (`card_id`);--> statement-breakpoint
CREATE INDEX `cl_job_idx` ON `card_links` (`job_id`);--> statement-breakpoint
CREATE INDEX `cl_quote_idx` ON `card_links` (`quote_id`);--> statement-breakpoint
CREATE INDEX `cl_part_idx` ON `card_links` (`part_id`);--> statement-breakpoint
CREATE INDEX `cl_machine_idx` ON `card_links` (`machine_id`);--> statement-breakpoint
CREATE INDEX `cl_material_idx` ON `card_links` (`material_id`);--> statement-breakpoint
CREATE INDEX `cl_customer_idx` ON `card_links` (`customer_id`);--> statement-breakpoint
CREATE INDEX `cl_person_idx` ON `card_links` (`person_id`);--> statement-breakpoint
CREATE TABLE `card_tags` (
	`card_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `tag_id`),
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `card_topics` (
	`card_id` text NOT NULL,
	`topic_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `topic_id`),
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ct_topic_idx` ON `card_topics` (`topic_id`);--> statement-breakpoint
CREATE TABLE `knowledge_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`supersedes_id` text,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`rationale` text,
	`common_mistake` text,
	`applies_when` text NOT NULL,
	`does_not_apply_when` text NOT NULL,
	`cues` text NOT NULL,
	`actions` text NOT NULL,
	`thresholds` text NOT NULL,
	`open_questions` text NOT NULL,
	`expert_confidence` text NOT NULL,
	`source_person_id` text NOT NULL,
	`recorded_by_persona_id` text,
	`source_kind` text NOT NULL,
	`source_interview_id` text,
	`created_by` text NOT NULL,
	`approved_by_person_id` text,
	`approved_at` text,
	`approved_on` text,
	`approval_mode` text,
	`review_notes` text,
	`script_key` text,
	`search_text` text NOT NULL,
	`search_tags` text NOT NULL,
	`created_on` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`supersedes_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "knowledge_cards_classification_ck" CHECK("knowledge_cards"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE INDEX `kc_status_class_idx` ON `knowledge_cards` (`status`,`classification`);--> statement-breakpoint
CREATE INDEX `kc_person_status_idx` ON `knowledge_cards` (`source_person_id`,`status`);--> statement-breakpoint
CREATE INDEX `kc_type_idx` ON `knowledge_cards` (`type`);--> statement-breakpoint
CREATE INDEX `kc_interview_idx` ON `knowledge_cards` (`source_interview_id`);--> statement-breakpoint
CREATE TABLE `ai_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`request_id` text NOT NULL,
	`parent_id` integer,
	`attempt` integer DEFAULT 1 NOT NULL,
	`actor_person_id` text,
	`actor_persona_id` text,
	`actor_role` text NOT NULL,
	`feature` text NOT NULL,
	`task` text NOT NULL,
	`mode` text NOT NULL,
	`decision` text NOT NULL,
	`provider_kind` text,
	`target_class` text,
	`model` text,
	`served_model` text,
	`endpoint_host` text,
	`region` text,
	`cross_region` text,
	`is_cloud` integer,
	`transport` text NOT NULL,
	`cassette_provenance` text,
	`max_classification` text,
	`classifications_included` text NOT NULL,
	`records_sent` text NOT NULL,
	`records_withheld` text NOT NULL,
	`notice_key` text,
	`notice_params` text,
	`redaction_token_count` integer DEFAULT 0 NOT NULL,
	`tokens_used` text NOT NULL,
	`user_input_redacted` text,
	`request_payload_redacted` text,
	`payload_hash` text,
	`payload_stored_form` text,
	`response_redacted` text,
	`prompt_version` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`ttft_ms` integer,
	`stop_reason` text,
	`outcome` text NOT NULL,
	`error_code` text,
	`citations_valid` integer DEFAULT 0 NOT NULL,
	`citations_stripped` integer DEFAULT 0 NOT NULL,
	`policy_version` text NOT NULL,
	`app_version` text NOT NULL,
	`demo_epoch` integer DEFAULT 0 NOT NULL,
	`tenant_id` text DEFAULT 'ridgeline' NOT NULL,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aal_created_idx` ON `ai_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `aal_actor_idx` ON `ai_audit_log` (`actor_person_id`);--> statement-breakpoint
CREATE INDEX `aal_feature_idx` ON `ai_audit_log` (`feature`);--> statement-breakpoint
CREATE INDEX `aal_provider_idx` ON `ai_audit_log` (`provider_kind`);--> statement-breakpoint
CREATE INDEX `aal_class_idx` ON `ai_audit_log` (`max_classification`);--> statement-breakpoint
CREATE INDEX `aal_decision_idx` ON `ai_audit_log` (`decision`);--> statement-breakpoint
CREATE INDEX `aal_transport_idx` ON `ai_audit_log` (`transport`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_persona_id` text,
	`tenant_id` text DEFAULT 'ridgeline' NOT NULL,
	FOREIGN KEY (`updated_by_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `coverage_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taken_at` text NOT NULL,
	`reason` text NOT NULL,
	`scope` text NOT NULL,
	`topic_id` text,
	`person_id` text,
	`coverage` real,
	`captured_pct` real,
	`risk` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cs_scope_idx` ON `coverage_snapshots` (`scope`,`topic_id`,`person_id`,`taken_at`);--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`actor_person_id` text,
	`actor_persona_id` text,
	`actor_role` text,
	`kind` text NOT NULL,
	`subject_kind` text,
	`subject_id` text,
	`classification` text,
	`details_json` text,
	`tenant_id` text DEFAULT 'ridgeline' NOT NULL,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `el_created_idx` ON `event_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `el_kind_idx` ON `event_log` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`file_path` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`uploaded_by_persona_id` text,
	`machine_id` text,
	`job_id` text,
	`card_id` text,
	`interview_id` text,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`uploaded_by_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_assets_classification_ck" CHECK("media_assets"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `redaction_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text,
	`real_value` text NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	`tenant_id` text DEFAULT 'ridgeline' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rt_value_uq` ON `redaction_tokens` (`kind`,`real_value`,`scope`);--> statement-breakpoint
CREATE TABLE `document_cards` (
	`document_id` text NOT NULL,
	`card_id` text NOT NULL,
	`card_version` integer NOT NULL,
	`section` text NOT NULL,
	`sort` integer NOT NULL,
	PRIMARY KEY(`document_id`, `card_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`supersedes_id` text,
	`machine_id` text,
	`part_id` text,
	`job_id` text,
	`for_person_id` text,
	`reviewer_person_id` text,
	`author_persona_id` text,
	`generated_by` text NOT NULL,
	`body` text NOT NULL,
	`body_md` text NOT NULL,
	`program_refs` text NOT NULL,
	`submitted_at` text,
	`approved_at` text,
	`approved_on` text,
	`approved_by_person_id` text,
	`review_notes` text,
	`script_key` text,
	`search_text` text NOT NULL,
	`created_on` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`supersedes_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`for_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_classification_ck" CHECK("documents"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE INDEX `doc_kind_status_idx` ON `documents` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `doc_machine_idx` ON `documents` (`machine_id`);--> statement-breakpoint
CREATE INDEX `doc_reviewer_idx` ON `documents` (`reviewer_person_id`,`status`);--> statement-breakpoint
CREATE TABLE `quiz_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`response` text NOT NULL,
	`grade` text NOT NULL,
	`criteria_results` text,
	`feedback_md` text,
	`graded_by` text NOT NULL,
	`audit_id` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `quiz_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`audit_id`) REFERENCES `ai_audit_log`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`person_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`score_pct` real,
	`status` text NOT NULL,
	`served_from` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_question_cards` (
	`question_id` text NOT NULL,
	`card_id` text NOT NULL,
	`card_version` integer NOT NULL,
	PRIMARY KEY(`question_id`, `card_id`),
	FOREIGN KEY (`question_id`) REFERENCES `quiz_questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`seq` integer NOT NULL,
	`item_type` text NOT NULL,
	`prompt` text NOT NULL,
	`scenario` text NOT NULL,
	`choices` text,
	`answer_key` text NOT NULL,
	`rubric` text NOT NULL,
	`primary_card_id` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`primary_card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quiz_questions_classification_ck" CHECK("quiz_questions"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`topic_id` text,
	`status` text NOT NULL,
	`generated_by` text NOT NULL,
	`approved_by_person_id` text,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quizzes_classification_ck" CHECK("quizzes"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `training_progress` (
	`person_id` text NOT NULL,
	`card_id` text NOT NULL,
	`correct_scenarios` integer DEFAULT 0 NOT NULL,
	`boundary_correct` integer DEFAULT false NOT NULL,
	`mastered_at` text,
	`last_attempt_at` text,
	`invalidated_at` text,
	PRIMARY KEY(`person_id`, `card_id`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `knowledge_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ask_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`pinned_refs` text NOT NULL,
	`sources` text NOT NULL,
	`audit_id` integer,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`thread_id`) REFERENCES `ask_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audit_id`) REFERENCES `ai_audit_log`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ask_messages_classification_ck" CHECK("ask_messages"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `am_seq_uq` ON `ask_messages` (`thread_id`,`seq`);--> statement-breakpoint
CREATE TABLE `ask_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_person_id` text,
	`mode_at_creation` text NOT NULL,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ask_threads_classification_ck" CHECK("ask_threads"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`machine_id` text NOT NULL,
	`job_id` text,
	`text` text,
	`media_asset_id` text,
	`status` text NOT NULL,
	`reviewer_person_id` text,
	`created_by_person_id` text,
	`created_at` text NOT NULL,
	`classification` text NOT NULL,
	`classification_source` text DEFAULT 'derived' NOT NULL,
	`classification_reason` text,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "captures_classification_ck" CHECK("captures"."classification" in ('general','internal','customer_confidential','export_controlled'))
);
--> statement-breakpoint
CREATE INDEX `captures_machine_idx` ON `captures` (`machine_id`);