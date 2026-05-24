CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "page_embeddings" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"embedding" vector(384) NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_embeddings" ADD CONSTRAINT "page_embeddings_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_embeddings" ADD CONSTRAINT "page_embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_embeddings_workspace_idx" ON "page_embeddings" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_embeddings_embedding_hnsw_idx"
  ON "page_embeddings"
  USING hnsw (embedding vector_cosine_ops);
