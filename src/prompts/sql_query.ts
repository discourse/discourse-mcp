/**
 * SQL Query Workflow Prompt
 *
 * Provides a guided workflow for discovering schema, writing queries,
 * and executing them via the Data Explorer plugin.
 */

import { z } from "zod";

export const sqlQueryPromptName = "sql_query";

export const sqlQueryPromptSchema = z.object({
  goal: z
    .string()
    .optional()
    .describe("What you want to learn from the data"),
});

export type SqlQueryPromptArgs = z.infer<typeof sqlQueryPromptSchema>;

export function getSqlQueryPromptContent(args: SqlQueryPromptArgs): string {
  const goal = args.goal || "Explore the database";

  return `# SQL Query Workflow

Goal: ${goal}

## Step 1: Discover Schema
Use the \`discourse://explorer/schema\` resource to explore available tables and columns.

Key tables you may find useful:
- **users** - User accounts (id, username, name, email, trust_level, created_at, last_seen_at)
- **topics** - Forum topics (id, title, user_id, category_id, created_at, views, posts_count)
- **posts** - Individual posts (id, topic_id, user_id, raw, cooked, created_at, post_number)
- **categories** - Topic categories (id, name, slug, parent_category_id)
- **tags** - Topic tags (id, name, topic_count)
- **topic_tags** - Join table for topics and tags
- **user_actions** - User activity log (user_id, action_type, target_topic_id, target_post_id)
- **notifications** - User notifications
- **groups** - User groups
- **group_users** - Group membership

## Step 2: Check Existing Queries
Use the \`discourse://explorer/queries\` resource to see if a similar query already exists.
This can save time and provide examples of working queries.

## Step 3: Write or Modify Query
- Use \`discourse_create_query\` to save a new query, or
- Use \`discourse_get_query\` to fetch an existing query's SQL for modification

### Query Parameter Syntax
Declare parameters in SQL comments at the top of your query:

\`\`\`sql
-- [params]
-- int :user_id
-- string :username = 'default_value'
-- null date :start_date

SELECT * FROM users WHERE id = :user_id
\`\`\`

### Supported Parameter Types
- **int** - Integer value
- **bigint** - Large integer
- **string** - Text value
- **boolean** - true/false
- **date** - Date (YYYY-MM-DD)
- **datetime** - Date and time
- **user_id** - User ID with autocomplete
- **post_id** - Post ID
- **topic_id** - Topic ID
- **category_id** - Category ID with autocomplete
- **group_id** - Group ID with autocomplete
- **badge_id** - Badge ID with autocomplete
- **int_list** - Comma-separated integers
- **string_list** - Comma-separated strings

Prefix with \`null\` to make a parameter optional: \`-- null int :optional_id\`

## Step 4: Run Query
Use \`discourse_run_query\` with the query ID and any required parameters.

Example:
\`\`\`json
{
  "id": 123,
  "params": { "user_id": 1 },
  "limit": 100
}
\`\`\`

## Safety Notes
- Queries run in **read-only transactions** with a 10-second timeout
- **Sensitive columns** (emails, IPs, tokens) are marked in the schema - handle with care
- Use **LIMIT** to avoid returning too many rows (default is usually fine)
- The \`explain\` option shows the query execution plan for debugging performance

## Example Queries

### Recent active users
\`\`\`sql
SELECT username, last_seen_at, trust_level
FROM users
WHERE last_seen_at > CURRENT_DATE - INTERVAL '7 days'
ORDER BY last_seen_at DESC
LIMIT 50
\`\`\`

### Posts per category (last 30 days)
\`\`\`sql
SELECT c.name, COUNT(p.id) as post_count
FROM posts p
JOIN topics t ON p.topic_id = t.id
JOIN categories c ON t.category_id = c.id
WHERE p.created_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY c.id, c.name
ORDER BY post_count DESC
\`\`\`

### User activity with parameters
\`\`\`sql
-- [params]
-- user_id :user_id

SELECT action_type, COUNT(*) as count
FROM user_actions
WHERE user_id = :user_id
GROUP BY action_type
ORDER BY count DESC
\`\`\`
`;
}
