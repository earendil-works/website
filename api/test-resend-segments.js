import { Resend } from 'resend';

const resend = new Resend('re_6jvonD9T_K7dtwpXJ1y3iy9vWSKVDcMh3');
const audienceId = '024be235-68c2-418e-8ad5-8d6f0bccc4af';

async function testResendSegments() {
  console.log('🔍 Listing segments...\n');

  // List all segments
  const { data: segments, error: listError } = await resend.segments.list();

  if (listError) {
    console.error('Error listing segments:', listError);
    return;
  }

  console.log('Found segments:');
  segments.data.forEach(segment => {
    console.log(`  - ${segment.name} (ID: ${segment.id})`);
  });

  // Find the "Website Subscribers" segment
  const websiteSubscribersSegment = segments.data.find(s => s.name === 'Website Subscribers');

  if (!websiteSubscribersSegment) {
    console.log('\n❌ "Website Subscribers" segment not found!');
    console.log('Available segments:', segments.data.map(s => s.name).join(', '));
    return;
  }

  console.log(`\n✅ Found "Website Subscribers" segment: ${websiteSubscribersSegment.id}`);

  // Test creating a contact with segment assignment
  console.log('\n📧 Testing contact creation with segment assignment...\n');

  const testEmail = `test+${Date.now()}@example.com`;

  const { data: contact, error: createError } = await resend.contacts.create({
    email: testEmail,
    firstName: 'Test',
    lastName: 'User',
    segments: [
      { id: websiteSubscribersSegment.id }
    ]
  });

  if (createError) {
    console.error('Error creating contact:', createError);
    return;
  }

  console.log('✅ Successfully created contact with segment assignment!');
  console.log('Contact details:', contact);

  // Clean up - remove the test contact
  console.log('\n🧹 Cleaning up test contact...');
  const { error: deleteError } = await resend.contacts.remove({
    id: contact.id
  });

  if (deleteError) {
    console.error('Error deleting contact:', deleteError);
  } else {
    console.log('✅ Test contact removed successfully');
  }
}

testResendSegments().catch(console.error);
