-- Sprint 10.6: o bucket definitivo precisa aceitar o mesmo limite do staging.
update storage.buckets
set file_size_limit=20971520,
    allowed_mime_types=array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id='crm-documents';
