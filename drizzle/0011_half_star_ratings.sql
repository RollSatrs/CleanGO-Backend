ALTER TABLE "orders" ALTER COLUMN "rating" TYPE numeric(2,1) USING "rating"::numeric(2,1);
ALTER TABLE "orders" ADD CONSTRAINT "orders_rating_half_star_check"
  CHECK ("rating" IS NULL OR ("rating" BETWEEN 0.5 AND 5 AND "rating" * 2 = trunc("rating" * 2)));
