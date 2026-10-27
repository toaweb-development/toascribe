-- M1.5 (hand-written, data only): «Innleggsnavn» is the default permalink structure (Tor). The install stored WordPress' day and
-- name, which no screen could change until now, and the site has answered post names all along: a stored value that is still that
-- default becomes the post name. A structure someone chose is left alone. Downgrade: set it back to '/%year%/%monthnum%/%day%/%postname%/'.
UPDATE "setting" SET "value" = '"/%postname%/"'::jsonb, "modified_at" = now()
WHERE "key" = 'permalink_structure' AND "value" = '"/%year%/%monthnum%/%day%/%postname%/"'::jsonb;
