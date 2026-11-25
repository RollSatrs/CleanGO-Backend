CREATE TABLE "notification_outbox" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "dedupe_key" text NOT NULL UNIQUE,
 "recipient_id" uuid NOT NULL REFERENCES "users"("id"),
 "order_id" uuid NOT NULL REFERENCES "orders"("id"),
 "kind" text NOT NULL,
 "message" text NOT NULL,
 "offer_id" uuid,
 "offer_round" integer,
 "expires_at" timestamptz,
 "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','sending','sent','failed','expired')),
 "attempts" integer NOT NULL DEFAULT 0,
 "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
 "lease_until" timestamptz,
 "lease_token" uuid,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 "sent_at" timestamptz,
 "last_error" text
);
--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" ("status","next_attempt_at","lease_until");
--> statement-breakpoint
CREATE FUNCTION cleango_queue_event_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders%ROWTYPE; recipient uuid; message_text text; old_cleaner uuid;
BEGIN
 SELECT * INTO o FROM orders WHERE id=NEW.order_id;
 CASE NEW.event_type
 WHEN 'order_accepted' THEN recipient:=o.user_id; message_text:='Клинер найден!';
 WHEN 'cleaner_en_route' THEN recipient:=o.user_id; message_text:='Клинер выехал к вам.';
 WHEN 'cleaner_arrived' THEN recipient:=o.user_id; message_text:='Клинер сообщил о прибытии.';
 WHEN 'cleaning_started' THEN recipient:=o.user_id; message_text:='Уборка началась.';
 WHEN 'cleaning_completed' THEN recipient:=o.user_id; message_text:='Клинер закончил уборку. Проверьте результат.';
 WHEN 'completion_reminder_sent' THEN recipient:=o.user_id; message_text:='Напоминание: проверьте результат уборки.';
 WHEN 'completion_support_escalated' THEN recipient:=o.user_id; message_text:='Подтверждение ожидается более 24 часов. Обращение зарегистрировано.';
 WHEN 'completion_confirmed' THEN recipient:=o.cleaner_id; message_text:='Клиент подтвердил уборку.';
 WHEN 'review_submitted' THEN recipient:=o.cleaner_id; message_text:='Клиент оставил оценку.';
 WHEN 'matching_timeout' THEN recipient:=o.user_id; message_text:='Не удалось найти исполнителя.';
 WHEN 'cleaner_released' THEN recipient:=o.user_id; message_text:='Исполнитель отказался. Выберите замену или отмену.';
 WHEN 'replacement_started' THEN
  SELECT cleaner_id INTO old_cleaner FROM order_incidents WHERE order_id=o.id AND kind='released' ORDER BY created_at DESC,id DESC LIMIT 1;
  recipient:=old_cleaner; message_text:='Начат повторный поиск исполнителя.';
 WHEN 'order_cancelled' THEN recipient:=CASE WHEN NEW.actor_id=o.user_id THEN o.cleaner_id ELSE o.user_id END; message_text:='Заказ отменён.';
 WHEN 'order_issue_reported' THEN recipient:=CASE WHEN NEW.actor_id=o.user_id THEN o.cleaner_id ELSE o.user_id END; message_text:='По заказу зарегистрировано обращение.';
 WHEN 'client_wait_started' THEN recipient:=o.user_id; message_text:='Клинер ожидает вас.';
 WHEN 'support_order_resumed' THEN recipient:=o.user_id; message_text:='Заказ возобновлён поддержкой.';
 ELSE RETURN NEW;
 END CASE;
 IF recipient IS NOT NULL THEN
  INSERT INTO notification_outbox(dedupe_key,recipient_id,order_id,kind,message)
  VALUES ('event:'||NEW.id||':'||recipient,recipient,o.id,NEW.event_type,message_text||' Заказ №'||left(o.id::text,8)||'. Откройте CleanGo для актуального статуса.')
  ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER cleango_event_notice AFTER INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION cleango_queue_event_notice();
--> statement-breakpoint
CREATE FUNCTION cleango_queue_offer_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status <> 'offered' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN IF OLD.status='offered' AND OLD.batch_number=NEW.batch_number THEN RETURN NEW; END IF; END IF;
 INSERT INTO notification_outbox(dedupe_key,recipient_id,order_id,kind,message,offer_id,offer_round,expires_at)
 VALUES ('offer:'||NEW.id||':'||NEW.batch_number,NEW.cleaner_id,NEW.order_id,'new_offer','Вам предложен новый заказ CleanGo. Откройте приложение, пока предложение активно.',NEW.id,NEW.batch_number,NEW.expires_at)
 ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER cleango_offer_notice AFTER INSERT OR UPDATE ON order_offers FOR EACH ROW EXECUTE FUNCTION cleango_queue_offer_notice();
--> statement-breakpoint
CREATE FUNCTION cleango_queue_support_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c order_incidents%ROWTYPE;
BEGIN
 IF NEW.action='claim' THEN RETURN NEW; END IF;
 SELECT * INTO c FROM order_incidents WHERE id=NEW.incident_id;
 INSERT INTO notification_outbox(dedupe_key,recipient_id,order_id,kind,message)
 VALUES ('support:'||NEW.id,c.actor_id,c.order_id,'support_update','Поддержка обновила ваше обращение. Откройте раздел «Поддержка» в CleanGo.')
 ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER cleango_support_notice AFTER INSERT ON support_audit FOR EACH ROW EXECUTE FUNCTION cleango_queue_support_notice();
