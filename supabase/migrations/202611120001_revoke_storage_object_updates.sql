-- Client uploads use unique immutable paths; updates stay server-only.
revoke update on storage.objects from anon, authenticated;
